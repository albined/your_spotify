import { Types } from "mongoose";

import { ImportRecord } from "../../tools/importers/records";
import {
  recordingKey,
  reviewEventKey,
  reviewHash,
  reviewRowKey,
} from "../../tools/importers/reviewIdentity";
import { ImportMappingModel, ImportReviewModel, TrackModel } from "../Models";
import {
  ImportReview,
  ReviewCategory,
  ReviewView,
} from "../schemas/importReview";
import { User } from "../schemas/user";
import { SpotifyReviewLinks } from "./privacyRules";

export class ReviewStore {
  private excluded = new Set<string>();
  isExcluded(row: ImportRecord) {
    return this.excluded.has(reviewEventKey(row));
  }
  private conflicts = new Set<string>();
  isConflicting(row: ImportRecord) {
    return this.conflicts.has(row.key);
  }
  private pending = new Set<string>();
  private timing = new Set<string>();
  needsTimingReview(row: ImportRecord) {
    return this.timing.has(reviewRowKey(row));
  }
  private occurrences = new Map<string, number>();
  async initialize(user: User, rows: ImportRecord[]) {
    const excluded = await ImportReviewModel.find({
      owner: user._id,
      excluded: true,
    })
      .select("record")
      .lean();
    this.excluded = new Set(
      excluded.map((item) => reviewEventKey(item.record)),
    );
    const keys = await ImportReviewModel.find({
      owner: user._id,
      status: "pending",
    })
      .select("key category record.key")
      .lean();
    this.pending = new Set(keys.map((item) => item.key));
    this.timing = new Set(
      keys.filter((item) => item.category === "legacy").map((item) => item.key),
    );
    this.conflicts = new Set(
      keys
        .filter((item) => item.category === "timestamp")
        .map((item) => item.record.key),
    );
    for (const row of rows) {
      const key = reviewRowKey(row);
      this.occurrences.set(key, (this.occurrences.get(key) ?? 0) + 1);
    }
  }
  async save(
    user: User,
    row: ImportRecord,
    category: ReviewCategory,
    reason: string,
    importId: string,
  ) {
    const key = reviewRowKey(row);
    const recording = recordingKey(row);
    if (
      (category === "recording" || category === "legacy") &&
      (await ImportReviewModel.exists({
        owner: user._id,
        status: { $in: ["pending", "no-match"] },
        "record.key": row.key,
        key: { $ne: key },
      }))
    ) {
      category = "timestamp";
      reason = "Overlapping exports disagree about this source event";
      await ImportReviewModel.updateMany(
        {
          owner: user._id,
          status: { $in: ["pending", "no-match"] },
          "record.key": row.key,
        },
        {
          $set: {
            category,
            status: "pending",
            reason,
            groupKey: reviewHash([row.source, row.at]),
          },
        },
      );
    }
    if (category === "timestamp") this.conflicts.add(row.key);
    const groupKey =
      category === "timestamp" ? reviewHash([row.source, row.at]) : recording;
    await ImportReviewModel.updateOne(
      { owner: user._id, key },
      {
        $set: {
          recordingKey: recording,
          groupKey,
          category,
          reason,
          status: "pending",
          lastImportId: importId,
          record: {
            ...row,
            at: Number.isFinite(row.at.getTime()) ? row.at : null,
          },
        },
        $setOnInsert: { firstImportId: importId },
        $max: { occurrences: this.occurrences.get(key) ?? 1 },
      },
      { upsert: true },
    );
    this.pending.add(key);
    return category;
  }
  async accepted(user: User, row: ImportRecord, importId: string) {
    const key = reviewRowKey(row);
    if (!this.pending.has(key)) return;
    await ImportReviewModel.updateOne(
      { owner: user._id, key, category: { $in: ["recording", "legacy"] } },
      { $set: { status: "resolved", resolvedBy: importId } },
    );
    this.pending.delete(key);
  }
  async skippedShort(user: User, row: ImportRecord, importId: string) {
    const key = reviewRowKey(row);
    if (!this.pending.has(key)) return;
    await ImportReviewModel.updateOne(
      { owner: user._id, key, status: "pending", category: "timestamp" },
      {
        $set: {
          status: "resolved",
          outcome: "short",
          resolvedBy: importId,
          reason: "Below the 30-second listening threshold",
        },
      },
    );
    this.pending.delete(key);
  }
  async noMatch(
    user: User,
    row: ImportRecord,
    importId: string,
    mappingId: string,
  ) {
    const category = await this.save(
      user,
      row,
      "recording",
      "Marked as not on Spotify",
      importId,
    );
    if (category !== "timestamp") {
      await ImportReviewModel.updateOne(
        { owner: user._id, key: reviewRowKey(row) },
        {
          $set: {
            status: "no-match",
            outcome: "no-match",
            resolvedBy: mappingId,
          },
        },
      );
      this.pending.delete(reviewRowKey(row));
    }
    return category;
  }
}

export const reviewFilter = (
  owner: Types.ObjectId,
  category: ReviewView,
  groupKey?: string,
) => ({
  owner,
  status:
    category === "no-match" ? ("no-match" as const) : ("pending" as const),
  category:
    category === "recording" || category === "no-match"
      ? { $in: ["recording", "legacy"] as ReviewCategory[] }
      : category,
  ...(groupKey ? { groupKey } : {}),
});

export async function listReviewGroups(user: User, category: ReviewView) {
  const hasListeningTime = {
    $and: [
      { $isNumber: "$record.listenedMs" },
      { $gte: ["$record.listenedMs", 0] },
    ],
  };
  const [groups, totals, counts] = await Promise.all([
    ImportReviewModel.aggregate([
      { $match: reviewFilter(user._id, category) },
      { $sort: { "record.at": 1, key: 1 } },
      {
        $group: {
          _id: "$groupKey",
          title: { $first: "$record.title" },
          artist: { $first: "$record.artist" },
          album: { $first: "$record.album" },
          isrc: { $first: "$record.isrc" },
          provider: { $first: "$record.provider" },
          source: { $first: "$record.source" },
          spotifyId: { $first: "$record.spotifyId" },
          count: { $sum: 1 },
          sourceRows: { $sum: "$occurrences" },
          // Repeated evidence is not an additional listen or additional time.
          listenedMs: {
            $sum: { $cond: [hasListeningTime, "$record.listenedMs", 0] },
          },
          timedCount: { $sum: { $cond: [hasListeningTime, 1, 0] } },
          start: { $min: "$record.at" },
          end: { $max: "$record.at" },
          categories: { $addToSet: "$category" },
        },
      },
      {
        $sort:
          category === "timestamp"
            ? { start: 1, _id: 1 }
            : { count: -1, title: 1, _id: 1 },
      },
    ]),
    ImportReviewModel.aggregate([
      { $match: { owner: user._id, status: { $in: ["pending", "no-match"] } } },
      {
        $group: {
          _id: {
            view: {
              $cond: [
                { $eq: ["$status", "no-match"] },
                "no-match",
                {
                  $cond: [
                    { $eq: ["$category", "legacy"] },
                    "recording",
                    "$category",
                  ],
                },
              ],
            },
            group: "$groupKey",
          },
        },
      },
      { $group: { _id: "$_id.view", count: { $sum: 1 } } },
    ]),
    ImportReviewModel.aggregate([
      { $match: { owner: user._id, status: "pending" } },
      {
        $group: {
          _id: "$category",
          count: { $sum: 1 },
          sourceRows: { $sum: "$occurrences" },
        },
      },
    ]),
  ]);
  counts.sort(
    (a, b) =>
      ["recording", "legacy", "timestamp", "invalid"].indexOf(a._id) -
      ["recording", "legacy", "timestamp", "invalid"].indexOf(b._id),
  );
  const mappings = await ImportMappingModel.find({
    owner: user._id,
    recordingKey: { $in: groups.map((g) => g._id) },
  })
    .select("recordingKey trackId noMatch")
    .lean();
  const knownSpotifyIds = new Set(
    await TrackModel.distinct("id", {
      id: {
        $in: groups
          .filter(
            (group) =>
              group.source === "full-privacy" &&
              group.categories.length === 1 &&
              group.categories[0] === "legacy",
          )
          .map((group) => group.spotifyId)
          .filter(Boolean),
      },
    }),
  );
  return {
    groups: groups.map((g) => ({
      ...g,
      savedTrackId:
        mappings.find((m) => m.recordingKey === g._id)?.trackId ??
        (!mappings.some((m) => m.recordingKey === g._id) &&
        knownSpotifyIds.has(g.spotifyId)
          ? g.spotifyId
          : undefined),
      noMatch: mappings.find((m) => m.recordingKey === g._id)?.noMatch ?? false,
    })),
    counts,
    groupCounts: Object.fromEntries(
      ["recording", "timestamp", "invalid", "no-match"].map((view) => [
        view,
        totals.find((total) => total._id === view)?.count ?? 0,
      ]),
    ),
  };
}

export async function getReviewRows(
  user: User,
  category: ReviewView,
  groupKey: string,
  offset = 0,
) {
  const filter = reviewFilter(user._id, category, groupKey);
  const [rows, total] = await Promise.all([
    ImportReviewModel.find(filter)
      .sort({ "record.at": 1, key: 1 })
      .skip(offset)
      .limit(50)
      .select("record category reason occurrences")
      .lean(),
    ImportReviewModel.countDocuments(filter),
  ]);
  return { rows, total };
}

export async function pendingRecording(user: User, key: string) {
  return ImportReviewModel.find(reviewFilter(user._id, "recording", key))
    .sort({ "record.at": 1, key: 1 })
    .lean();
}

export async function resolveReviewRow(
  user: User,
  item: ImportReview & { _id: Types.ObjectId },
  resolvedBy: string,
  outcome: string,
  deltaMs: number,
) {
  await ImportReviewModel.updateOne(
    { _id: item._id, owner: user._id },
    {
      $set:
        outcome === "ambiguous"
          ? {
              category: "legacy",
              reason:
                "Recording selected; existing play timing still needs review",
            }
          : { status: "resolved", resolvedBy, outcome, deltaMs },
    },
  );
  if (outcome !== "ambiguous" && item.record.source === "full-privacy") {
    const links = new SpotifyReviewLinks();
    await links.initialize(user, [item.record]);
    await links.accepted(user, item.record);
  }
}

export async function savedMappings(user: User) {
  const mappings = await ImportMappingModel.find({ owner: user._id }).lean();
  const tracks = await TrackModel.find({
    id: { $in: mappings.flatMap((m) => (m.trackId ? [m.trackId] : [])) },
  }).lean();
  const byId = new Map(tracks.map((track) => [track.id, track]));
  return new Map(
    mappings.map((mapping) => [
      mapping.recordingKey,
      {
        id: mapping._id.toString(),
        trackId: mapping.trackId,
        noMatch: mapping.noMatch ?? false,
        track: mapping.trackId ? byId.get(mapping.trackId) : undefined,
      },
    ]),
  );
}

export async function markNoMatch(user: User, group: string) {
  let mapping = await ImportMappingModel.findOne({
    owner: user._id,
    recordingKey: group,
  });
  if (mapping && !mapping.noMatch)
    throw new Error("A Spotify match is already saved for this recording");
  if (!mapping) {
    const rows = await pendingRecording(user, group);
    if (!rows.length)
      throw new Error(
        "This recording has no pending items. Refresh the review list.",
      );
    mapping = await ImportMappingModel.create({
      owner: user._id,
      recordingKey: group,
      noMatch: true,
      sourceTitle: rows[0]!.record.title,
      sourceArtist: rows[0]!.record.artist,
    });
  }
  await ImportReviewModel.updateMany(
    reviewFilter(user._id, "recording", group),
    {
      $set: {
        status: "no-match",
        outcome: "no-match",
        resolvedBy: mapping._id.toString(),
      },
    },
  );
}

export async function reopenNoMatch(user: User, group: string) {
  const mapping = await ImportMappingModel.findOne({
    owner: user._id,
    recordingKey: group,
  }).lean();
  if (mapping && !mapping.noMatch)
    throw new Error("A Spotify match is already saved for this recording");
  // Delete first: if interrupted, the saved no-match rows still allow a retry.
  await ImportMappingModel.deleteOne({
    owner: user._id,
    recordingKey: group,
    noMatch: true,
  });
  await ImportReviewModel.updateMany(
    reviewFilter(user._id, "no-match", group),
    { $set: { status: "pending" }, $unset: { outcome: 1, resolvedBy: 1 } },
  );
}
