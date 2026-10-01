import { Types } from "mongoose";

import { trackDescriptions } from "../../tools/importers/reviewCatalog";
import { reviewHash } from "../../tools/importers/reviewIdentity";
import {
  ImportMappingModel,
  ImportReviewModel,
  InfosModel,
  TrackModel,
} from "../Models";
import { User } from "../schemas/user";
import { planDeezerRows } from "./deezerRules";
import { ImportContext } from "./importContext";
import {
  canLinkImportListen,
  importMatchTimeFilter,
  reconcileImport,
} from "./importListening";
import { resolveReviewRow, reviewFilter } from "./importReview";
import { SpotifyReviewLinks } from "./privacyRules";

async function timingPlan(user: User, group: string, rowId?: string) {
  const item = await ImportReviewModel.findOne({
    ...reviewFilter(user._id, "recording", group),
    ...(rowId ? { _id: rowId } : {}),
  })
    .sort({ "record.at": 1, key: 1 })
    .lean();
  if (!item)
    throw new Error("This item is no longer pending. Refresh the review.");
  const mapping = await ImportMappingModel.findOne({
    owner: user._id,
    recordingKey: item.recordingKey,
  }).lean();
  const trackId =
    mapping?.trackId ??
    (!mapping &&
    item.category === "legacy" &&
    item.record.source === "full-privacy"
      ? item.record.spotifyId
      : undefined);
  const track = trackId
    ? await TrackModel.findOne({ id: trackId }).lean()
    : null;
  if (!track) throw new Error("Choose a Spotify recording first.");
  let row = item.record;
  if (item.policyVersion === 1) {
    const policy = await planDeezerRows(user, [row]);
    row = policy.plans.get(0)?.row ?? row;
  }
  if (
    !Number.isFinite(row.at?.getTime()) ||
    row.invalid ||
    (row.ambiguous && !row.deezerPolicy) ||
    (row.listenedMs !== null && row.listenedMs < 30000) ||
    (row.listenedMs === null && !(track.duration_ms > 0))
  )
    throw new Error(
      "Reupload this export to apply the current import rules before reviewing its timing.",
    );
  const identity = new ImportContext();
  identity.reviewMapping = {
    id: mapping?._id.toString() ?? `export:${item.recordingKey}`,
    trackId: track.id,
  };
  const matches = await identity.matchingTracks(row, track);
  const keys = row.deezerPolicy?.sourceKeys ?? [row.key];
  const candidates = await InfosModel.find({
    owner: user._id,
    $and: [
      { $or: [{ provider: row.provider }, { provider: { $exists: false } }] },
      {
        $or: [
          { sourceKeys: { $in: keys, $type: "string" } },
          {
            $and: [importMatchTimeFilter(row, track)],
            $or: [
              { id: { $in: [...matches.confirmed, ...matches.uncertain] } },
              {
                played_at: row.at,
                listeningSource: { $exists: false },
                sourceKeys: { $exists: false },
              },
            ],
          },
        ],
      },
    ],
  })
    .sort({ played_at: -1, _id: 1 })
    .limit(21);
  const linked = candidates.filter((play) =>
    play.sourceKeys?.some((key) => keys.includes(key)),
  );
  const canUse = (play: (typeof candidates)[number]) =>
    linked.length
      ? linked.length === 1 && linked[0]!._id.equals(play._id)
      : canLinkImportListen(row, play);
  const token = reviewHash([
    item,
    row,
    mapping,
    track,
    candidates.map((play) => play.toObject()),
    user.settings.blacklistedArtists,
  ]);
  return {
    item,
    row,
    track,
    identity,
    candidates,
    canUse,
    token,
    canAdd: !linked.length,
  };
}

export async function getTimingReview(user: User, group: string) {
  const plan = await timingPlan(user, group);
  const { item, row, track, candidates, canUse, token, canAdd } = plan;
  const tracks = await TrackModel.find({
    id: { $in: candidates.map((p) => p.id) },
  }).lean();
  const descriptions = await trackDescriptions(tracks);
  const [chosen] = await trackDescriptions([track]);
  return {
    rowId: item._id.toString(),
    token,
    canAdd,
    export: {
      at: row.at,
      listenedMs: row.listenedMs ?? track.duration_ms,
      estimated: row.listenedMs === null,
      track: chosen!,
    },
    candidates: candidates
      .slice(0, 20)
      .map((play) => ({
        id: play._id.toString(),
        at: play.played_at,
        listenedMs: play.listenedMs ?? play.durationMs,
        estimated: play.listenedMs == null,
        track: descriptions.find((t) => t.id === play.id) ?? null,
        canUse: canUse(play),
      })),
    moreCandidates: candidates.length > 20,
  };
}

export async function resolveTimingReview(
  user: User,
  group: string,
  rowId: string,
  token: string,
  existingId: string | null,
  exclude = false,
) {
  // A repeated request after the queue update is an idempotent success.
  const resolved = await ImportReviewModel.findOne({
    _id: rowId,
    owner: user._id,
    groupKey: group,
    status: "resolved",
  })
    .select("excluded")
    .lean();
  if (resolved)
    return {
      outcome: resolved.excluded ? "excluded" : "unchanged",
      deltaMs: 0,
    };
  const plan = await timingPlan(user, group, rowId);
  if (plan.token !== token)
    throw new Error(
      "History changed. Refresh the comparison and choose again.",
    );
  if (exclude) {
    const keys = plan.row.deezerPolicy?.sourceKeys ?? [plan.row.key];
    if (
      existingId ||
      (await InfosModel.exists({
        owner: user._id,
        sourceKeys: { $in: keys, $type: "string" },
      }))
    )
      throw new Error(
        "This entry is already linked to a saved listen. Refresh the comparison.",
      );
    await ImportReviewModel.updateOne(
      { _id: plan.item._id, owner: user._id, status: "pending" },
      {
        $set: {
          excluded: true,
          status: "resolved",
          outcome: "excluded",
          deltaMs: 0,
          reason: "Not added by your choice",
          resolvedBy: plan.identity.reviewMapping!.id,
        },
      },
    );
    if (plan.row.source === "full-privacy") {
      const links = new SpotifyReviewLinks();
      await links.initialize(user, [plan.row]);
      await links.accepted(user, plan.row, true);
    }
    return { outcome: "excluded", deltaMs: 0 };
  }
  if (existingId) {
    const candidate = plan.candidates.find((p) =>
      p._id.equals(new Types.ObjectId(existingId)),
    );
    if (!candidate || !plan.canUse(candidate))
      throw new Error(
        "This saved listen cannot be used for this export entry.",
      );
  } else if (!plan.canAdd) {
    throw new Error("This export entry is already linked to a saved listen.");
  }
  const mappingId = plan.identity.reviewMapping!.id;
  const result = await reconcileImport(
    user,
    plan.row,
    plan.track,
    `review:${mappingId}`,
    rowId,
    plan.identity,
    false,
    { existingId },
  );
  if (result.outcome === "ambiguous")
    throw new Error(
      "Multiple saved listens already claim this export entry. No changes were made.",
    );
  await resolveReviewRow(
    user,
    plan.item,
    mappingId,
    result.outcome,
    result.deltaMs,
  );
  return result;
}
