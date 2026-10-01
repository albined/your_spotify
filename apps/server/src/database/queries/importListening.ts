import { Types } from "mongoose";

import { ImportRecord } from "../../tools/importers/records";
import { reviewHash } from "../../tools/importers/reviewIdentity";
import { InfosModel, TrackModel } from "../Models";
import { Infos } from "../schemas/info";
import { Track } from "../schemas/track";
import { User } from "../schemas/user";
import { ImportContext } from "./importContext";

export type ImportOutcome = "added" | "updated" | "unchanged" | "ambiguous";
export interface ReconcileResult {
  outcome: ImportOutcome;
  deltaMs: number;
  stateHash?: string;
  estimated?: boolean;
}
const priority = { privacy: 1, "full-privacy": 2, deezer: 2 };

/** API provenance does not mean a listen has already been claimed by an export. */
export function canLinkImportListen(row: ImportRecord, play: Infos) {
  return (
    (!play.provider || play.provider === row.provider) &&
    !play.listeningSource &&
    (!play.sourceKeys?.length ||
      (row.provider === "spotify" &&
        play.sourceKeys.every((key) => key.startsWith("api:"))))
  );
}

export function importMatchTimeFilter(row: ImportRecord, track: Track) {
  const end = row.at.getTime();
  const duration = Math.max(row.listenedMs ?? 0, track.duration_ms);
  const before = Math.max(
    duration + 60000,
    row.provider === "spotify" ? 900000 : 0,
  );
  const after = row.provider === "spotify" ? before : 60000;
  return {
    $or: [
      {
        played_at: {
          $gte: new Date(end - before),
          // The search window alone cannot establish a match. Extended exports
          // also compare neighbouring source events before linking delayed plays.
          $lte: new Date(end + after),
        },
      },
      {
        // A later extended export must find an already linked account export,
        // even when its preserved API timestamp is outside the search window.
        sourceEndedAt: {
          $gte: new Date(end - 60000),
          $lte: new Date(end + 60000),
        },
      },
    ],
  };
}

export const importSourceKeyFilter = (owner: Types.ObjectId, key: string) => ({
  owner,
  // Mongo 6 needs the partial-index predicate explicitly to use this index.
  sourceKeys: { $eq: key, $type: "string" as const },
});

/** Called under the same write lock as live ingestion. No Spotify calls here. */
export async function reconcileImport(
  user: User,
  row: ImportRecord,
  track: Track,
  importId: string,
  rowIndex: number | string,
  identity = new ImportContext(),
  dryRun = false,
  decision?: { existingId: string | null },
): Promise<ReconcileResult> {
  const manual =
    identity.reviewMapping?.trackId === track.id
      ? identity.reviewMapping
      : undefined;
  const rowId = `${importId}:${rowIndex}`;
  const sourceKeys = row.deezerPolicy?.sourceKeys ?? [row.key];
  const keyedRows = row.deezerPolicy
    ? await InfosModel.find({
        owner: user._id,
        sourceKeys: { $in: sourceKeys, $type: "string" },
      })
    : [];
  if (keyedRows.length > 1) return { outcome: "ambiguous", deltaMs: 0 };
  const keyed = row.deezerPolicy
    ? (keyedRows[0] ?? null)
    : await InfosModel.findOne(importSourceKeyFilter(user._id, row.key));
  const end = row.at.getTime();
  const start = end - (row.listenedMs ?? track.duration_ms);
  const tolerance = row.precisionMs;
  let existing = keyed;
  let repairRecording = false;
  let separateSpotifyListen = false;
  const privacyKey = identity.privacyUpgradeKey(row);
  if (!existing && privacyKey && !decision) {
    const previous = await InfosModel.findOne({
      ...importSourceKeyFilter(user._id, privacyKey),
      listeningSource: "privacy",
      provider: "spotify",
      listenedMs: row.listenedMs,
    });
    if (previous) {
      const matches = await identity.matchingTracks(row, track);
      repairRecording = !matches.confirmed.includes(previous.id);
      if (repairRecording && previous.recordingMappingId)
        return { outcome: "ambiguous", deltaMs: 0 };
      existing = previous;
    }
  }
  if (
    decision?.existingId &&
    keyed &&
    keyed._id.toString() !== decision.existingId
  )
    throw new Error(
      "This export entry is already linked to another saved listen. Refresh the review.",
    );
  if (decision && !manual)
    throw new Error("Choose a recording before reviewing its saved listens");
  if (decision?.existingId && !existing) {
    existing = await InfosModel.findOne({
      _id: decision.existingId,
      owner: user._id,
      $or: [{ provider: row.provider }, { provider: { $exists: false } }],
    });
    if (!existing || !canLinkImportListen(row, existing))
      throw new Error(
        "This listen is already linked to another export entry. Refresh the review.",
      );
    const matches = await identity.matchingTracks(row, track);
    repairRecording = !matches.confirmed.includes(existing.id);
  }
  if (existing && manual && existing.id !== track.id && !repairRecording) {
    const matches = await identity.matchingTracks(row, track);
    if (!matches.confirmed.includes(existing.id))
      return { outcome: "ambiguous", deltaMs: 0 };
  }
  if (!existing && !decision) {
    // Legacy exports stored the end timestamp; API timestamps may correspond
    // to the start or end. A nearby interior timestamp is uncertain (pauses).
    const earliest = end - Math.max(row.listenedMs ?? 0, track.duration_ms);
    const matches = await identity.matchingTracks(row, track);
    // Deezer's old importer stored this exact export timestamp. A unique
    // exact event takes precedence over nearby listens, which are separate.
    let exact =
      row.source === "deezer"
        ? await InfosModel.find({
            owner: user._id,
            played_at: row.at,
            $or: [{ provider: "deezer" }, { provider: { $exists: false } }],
          })
        : [];
    if (row.deezerPolicy) {
      const confirmed = exact.filter((play) =>
        matches.confirmed.includes(play.id),
      );
      const repairable = exact.filter((play) =>
        identity.canRepairRecording(row, track, play),
      );
      const uncertain = exact.some((play) =>
        matches.uncertain.includes(play.id),
      );
      exact = confirmed.length ? confirmed : repairable;
      if (!exact.length && uncertain)
        return { outcome: "ambiguous", deltaMs: 0 };
    }
    if (exact.length > 1) return { outcome: "ambiguous", deltaMs: 0 };
    if (exact[0]) {
      existing = exact[0];
      if (
        (existing.listeningSource && existing.listeningSource !== "deezer") ||
        (existing.sourceEndedAt && existing.sourceEndedAt.getTime() !== end)
      )
        return { outcome: "ambiguous", deltaMs: 0 };
      if (!matches.confirmed.includes(existing.id)) {
        repairRecording = identity.canRepairRecording(row, track, existing);
        if (!repairRecording) return { outcome: "ambiguous", deltaMs: 0 };
      }
    }
    if (!existing) {
      const uncertain = new Set(matches.uncertain);
      const found = await InfosModel.find({
        owner: user._id,
        id: { $in: [...matches.confirmed, ...matches.uncertain] },
        $or: [{ provider: row.provider }, { provider: { $exists: false } }],
        $and: [importMatchTimeFilter(row, track)],
      });
      const candidateMatch = (play: Infos) =>
        identity.spotifyEndMatch(row, play, matches.confirmed);
      const candidates = found.filter(
        (play) => candidateMatch(play) !== "other",
      );
      const endMatches = (play: Infos) => {
        const at = (play.sourceEndedAt ?? play.played_at).getTime();
        if (play.listeningSource === "privacy")
          return end >= at && end < at + 60000;
        if (row.source === "privacy") return at >= end && at < end + 60000;
        return (
          Math.abs(at - end) < tolerance ||
          (canLinkImportListen(row, play) && candidateMatch(play) === "same")
        );
      };
      const startMatches = (play: Infos) => {
        if (row.provider !== "spotify" || play.listeningSource) return false;
        const at = play.played_at.getTime();
        return row.source === "privacy"
          ? at >= start && at < start + tolerance
          : Math.abs(at - start) < tolerance;
      };
      const eligible = candidates.filter((play) => {
        // Different precise timestamps from one source are separate listens.
        // Labels/release IDs can change between exports of the same event.
        if (play.listeningSource === row.source && play.sourceKeys?.length)
          return play.sourceEndedAt?.getTime() === end;
        if (play.listeningSource) return endMatches(play);
        const at = play.played_at.getTime();
        if (row.source === "privacy")
          return at >= earliest - 60000 && at <= end + (end - earliest) + 60000;
        return (
          endMatches(play) ||
          startMatches(play) ||
          (at >= earliest && at <= end)
        );
      });
      const confident = eligible.filter(
        (play) => endMatches(play) || startMatches(play),
      );
      const unclaimed = found.filter((play) => canLinkImportListen(row, play));
      const automatic = found.some(
        (play) =>
          uncertain.has(play.id) ||
          (!canLinkImportListen(row, play) &&
            (!play.listeningSource || endMatches(play))),
      )
        ? undefined
        : identity.closestSpotifyListen(row, unclaimed, matches.confirmed);
      if (automatic) {
        existing = automatic.existing;
        separateSpotifyListen = !existing;
      } else if (
        eligible.some((play) => uncertain.has(play.id)) ||
        eligible.length > 1 ||
        (eligible.length && confident.length !== 1) ||
        (row.provider === "spotify" &&
          !eligible.length &&
          candidates.some((play) => !play.listeningSource))
      ) {
        return { outcome: "ambiguous", deltaMs: 0 };
      } else {
        existing = confident[0] ?? null;
      }
    }
  }
  if (
    !existing &&
    !decision &&
    identity.holdUnmatched &&
    !separateSpotifyListen
  )
    return { outcome: "ambiguous", deltaMs: 0 };
  const previewState = () => ({
    stateHash: reviewHash([
      existing?.toObject() ?? null,
      track.id,
      track.duration_ms,
      user.settings.blacklistedArtists,
    ]),
  });
  if (existing?.lastImportRow === rowId) {
    // Recover a row committed before its progress checkpoint was saved.
    if (!dryRun) await identity.repairMembership(user, existing);
    return {
      ...(dryRun ? previewState() : {}),
      outcome: existing.lastImportOutcome ?? "unchanged",
      deltaMs: existing.lastImportDeltaMs ?? 0,
      ...(row.deezerPolicy && existing.listenedMs == null
        ? { estimated: true }
        : {}),
    };
  }
  if (existing) {
    const listenedMs =
      row.deezerPolicy &&
      existing.listeningSource === "deezer" &&
      existing.listenedMs != null
        ? Math.max(row.listenedMs ?? 0, existing.listenedMs)
        : row.listenedMs;
    const canCorrect =
      listenedMs !== null &&
      (!existing.listeningSource ||
        priority[row.source] >= priority[existing.listeningSource]);
    const changed =
      repairRecording || (canCorrect && existing.listenedMs !== listenedMs);
    const estimated =
      row.deezerPolicy &&
      (canCorrect ? listenedMs : existing.listenedMs) == null
        ? { estimated: true }
        : {};
    if (
      !changed &&
      (!row.deezerPolicy?.timestampUncertain || existing.timestampUncertain) &&
      sourceKeys.every((key) => existing.sourceKeys?.includes(key)) &&
      (!canCorrect ||
        (existing.listeningSource === row.source &&
          existing.sourceEndedAt?.getTime() === end))
    ) {
      // Repeated exports need no event write. A retry returns the same zero
      // delta without replacing the result of an earlier durable mutation.
      if (!dryRun) await identity.repairMembership(user, existing);
      return {
        outcome: "unchanged",
        deltaMs: 0,
        ...estimated,
        ...(dryRun ? previewState() : {}),
      };
    }
    const deltaMs = changed
      ? (canCorrect
          ? listenedMs!
          : (existing.listenedMs ?? track.duration_ms)) -
        (existing.listenedMs ?? existing.durationMs)
      : 0;
    const outcome = changed ? "updated" : "unchanged";
    if (dryRun) return { outcome, deltaMs, ...estimated, ...previewState() };
    const recomputeBlacklist =
      repairRecording && existing.primaryArtistId !== track.artists[0];
    const blacklist = user.settings.blacklistedArtists.includes(
      track.artists[0]!,
    );
    await InfosModel.updateOne(
      { _id: existing._id },
      {
        ...(recomputeBlacklist && !blacklist
          ? { $unset: { blacklistedBy: 1 } }
          : {}),
        $addToSet: { sourceKeys: { $each: sourceKeys } },
        $set: {
          provider: row.provider,
          ...(row.deezerPolicy?.timestampUncertain
            ? { timestampUncertain: true }
            : {}),
          ...(row.deezerPolicy && !existing.listeningSource
            ? {
                listeningSource: row.source,
                sourceEndedAt: row.at,
                durationImportId: importId,
              }
            : {}),
          ...(manual &&
          (!row.deezerPolicy || changed || !existing.sourceKeys?.length)
            ? { recordingMappingId: manual.id }
            : {}),
          lastImportRow: rowId,
          lastImportOutcome: outcome,
          lastImportDeltaMs: deltaMs,
          ...(repairRecording
            ? {
                recordingRepair: {
                  importId,
                  id: existing.id,
                  albumId: existing.albumId,
                  primaryArtistId: existing.primaryArtistId,
                  artistIds: existing.artistIds,
                  durationMs: existing.durationMs,
                  ...(existing.blacklistedBy
                    ? { blacklistedBy: existing.blacklistedBy }
                    : {}),
                },
                id: track.id,
                albumId: track.album,
                primaryArtistId: track.artists[0],
                artistIds: track.artists,
                durationMs: track.duration_ms,
                ...(recomputeBlacklist && blacklist
                  ? { blacklistedBy: "artist" }
                  : {}),
              }
            : {}),
          ...(canCorrect
            ? {
                listenedMs,
                listeningSource: row.source,
                sourceEndedAt: row.at,
                durationImportId: importId,
              }
            : {}),
        },
      },
    );
    // Also repairs membership if a previous insert was interrupted.
    await identity.repairMembership(user, existing);
    return { outcome, deltaMs, ...estimated };
  }
  const primaryArtistId = track.artists[0];
  if (!primaryArtistId) return { outcome: "ambiguous", deltaMs: 0 };
  const deltaMs = row.listenedMs ?? track.duration_ms;
  const estimated =
    row.deezerPolicy && row.listenedMs === null ? { estimated: true } : {};
  if (dryRun)
    return { outcome: "added", deltaMs, ...estimated, ...previewState() };
  const created = await InfosModel.create({
    ...(manual ? { recordingMappingId: manual.id } : {}),
    owner: user._id,
    id: track.id,
    played_at: row.at,
    durationMs: track.duration_ms,
    albumId: track.album,
    primaryArtistId,
    artistIds: track.artists,
    provider: row.provider,
    sourceKeys,
    ...(row.deezerPolicy?.timestampUncertain
      ? { timestampUncertain: true }
      : {}),
    sourceEndedAt: row.at,
    ...(row.deezerPolicy
      ? { listeningSource: row.source, durationImportId: importId }
      : {}),
    ...(row.listenedMs !== null
      ? {
          listenedMs: row.listenedMs,
          listeningSource: row.source,
          durationImportId: importId,
        }
      : {}),
    lastImportRow: rowId,
    lastImportOutcome: "added",
    lastImportDeltaMs: deltaMs,
    ...(user.settings.blacklistedArtists.includes(primaryArtistId)
      ? { blacklistedBy: "artist" }
      : {}),
  });
  await identity.repairMembership(user, created);
  return { outcome: "added", deltaMs, ...estimated };
}

/** Check and durably claim an API event under the live-ingestion write lock. */
export async function hasLivePlay(
  owner: Types.ObjectId,
  id: string,
  at: Date,
  isrc?: string,
) {
  const sourceKey = `api:${id}:${at.toISOString()}`;
  if (await InfosModel.exists(importSourceKeyFilter(owner, sourceKey)))
    return true;
  const recording =
    isrc ??
    (await TrackModel.findOne({ id }).select("external_ids").lean())
      ?.external_ids?.isrc;
  const ids = recording
    ? [
        id,
        ...(
          await TrackModel.find({
            "external_ids.isrc": recording.toUpperCase(),
          })
            .select("id")
            .lean()
        ).map((track) => track.id),
      ]
    : [id];
  const linked = await InfosModel.exists({
    owner,
    id: { $in: ids },
    provider: { $ne: "deezer" },
    // A claimed API release might not be cached yet. The saved recording's
    // confirmed ISRC and exact API timestamp also establish a release alias.
    sourceKeys: {
      $regex: `^api:[^:]+:${at.toISOString().replace(/[.+]/g, "\\$&")}$`,
    },
  });
  if (linked) return true;
  // Once linked, an export's start/end cannot claim a different API event.
  const unclaimed = {
    owner,
    id: { $in: ids },
    provider: { $ne: "deezer" as const },
    sourceKeys: { $not: { $elemMatch: { $regex: "^api:" } } },
  };
  const claim = async (_id: Types.ObjectId) => {
    const result = await InfosModel.updateOne(
      { ...unclaimed, _id },
      { $addToSet: { sourceKeys: sourceKey }, $set: { provider: "spotify" } },
    );
    return result.modifiedCount === 1;
  };
  const exact = await InfosModel.findOne({
    ...unclaimed,
    played_at: at,
  }).select("_id");
  if (exact) return claim(exact._id);
  const matches = await InfosModel.aggregate<{ _id: Types.ObjectId }>([
    {
      $match: {
        ...unclaimed,
        sourceEndedAt: {
          $gte: new Date(at.getTime() - 60000),
          $lte: new Date(at.getTime() + 86400000),
        },
      },
    },
    {
      $match: {
        $expr: {
          $let: {
            vars: {
              tolerance: {
                $cond: [{ $eq: ["$listeningSource", "privacy"] }, 60000, 1000],
              },
            },
            in: {
              $or: [
                {
                  $lt: [
                    { $abs: { $subtract: ["$sourceEndedAt", at] } },
                    "$$tolerance",
                  ],
                },
                {
                  $lt: [
                    {
                      $abs: {
                        $subtract: [
                          { $subtract: ["$sourceEndedAt", "$listenedMs"] },
                          at,
                        ],
                      },
                    },
                    "$$tolerance",
                  ],
                },
              ],
            },
          },
        },
      },
    },
    { $project: { _id: 1 } },
    { $limit: 2 },
  ]);
  return matches.length === 1 && claim(matches[0]!._id);
}
