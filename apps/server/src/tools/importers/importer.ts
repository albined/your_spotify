import { unlink } from "node:fs/promises";

import { Types } from "mongoose";

import { ImporterStateModel, UserModel } from "../../database/Models";
import {
  planDeezerRows,
  saveDeezerEvidence,
} from "../../database/queries/deezerRules";
import { ImportContext } from "../../database/queries/importContext";
import { reconcileImport } from "../../database/queries/importListening";
import {
  ReviewStore,
  savedMappings,
} from "../../database/queries/importReview";
import {
  planSpotifyRows,
  SpotifyReviewLinks,
} from "../../database/queries/privacyRules";
import { ReviewCategory } from "../../database/schemas/importReview";
import { User } from "../../database/schemas/user";
import { backupBeforeImport } from "../backups";
import { longWriteDbLock } from "../lock";
import { logger } from "../logger";
import {
  importFingerprint,
  importRange,
  ImportSource,
  readImportRecords,
} from "./records";
import { ImportResolver } from "./resolve";
import { recordingKey } from "./reviewIdentity";
import { emptySummary } from "./types";
import { claimImportWork, releaseImportWork } from "./work";
export { canUserImport } from "./work";

export async function prepareImport(
  user: User,
  type: ImportSource,
  files: string[],
  timezone: string,
  repairLegacyDeezer = false,
) {
  if (repairLegacyDeezer && type !== "deezer")
    throw new Error("Legacy recording repairs require a Deezer export");
  const rows = await readImportRecords(type, files, timezone);
  return ImporterStateModel.create({
    user: user._id,
    type,
    metadata: files,
    timezone,
    repairLegacyDeezer,
    ...(type === "deezer" ? { deezerPolicyVersion: 1, estimated: 0 } : {}),
    total: rows.length,
    current: 0,
    status: "ready",
    stage: "ready",
    range: importRange(rows),
    fingerprint: importFingerprint(rows, 2),
    fingerprintVersion: 2,
    summary: emptySummary(),
    issueCounts: { recording: 0, legacy: 0, timestamp: 0, invalid: 0 },
    issues: [],
  });
}

export async function cleanupImport(id: string) {
  const state = await ImporterStateModel.findOneAndUpdate(
    { _id: id, status: { $in: ["ready", "failure"] } },
    { status: "failure-removed" },
  );
  if (!state) return;
  await Promise.all(state.metadata.map((file) => unlink(file).catch(() => {})));
}

export async function runImporter(id: string, user: User) {
  const userId = user._id.toString();
  claimImportWork(userId);
  try {
    const state = await ImporterStateModel.findOneAndUpdate(
      {
        _id: new Types.ObjectId(id),
        user: user._id,
        status: { $in: ["ready", "failure"] },
      },
      { $set: { status: "progress", stage: "backup" }, $unset: { error: 1 } },
      { returnDocument: "after" },
    );
    if (!state) throw new Error("Import is not ready to start");
    try {
      let rows = await readImportRecords(
        state.type,
        state.metadata,
        state.timezone ?? "UTC",
      );
      if (
        rows.length !== state.total ||
        (state.fingerprint &&
          state.fingerprint !==
            importFingerprint(rows, state.fingerprintVersion ?? 1))
      )
        throw new Error("Import files changed; upload them again");
      const backup = await backupBeforeImport();
      await ImporterStateModel.updateOne(
        { _id: id },
        { stage: "importing", ...(backup ? { backup } : {}) },
      );
      if (state.type !== "deezer") rows = await planSpotifyRows(user, rows, id);
      const resolver = new ImportResolver(userId);
      const identity = new ImportContext(state.repairLegacyDeezer, rows);
      for (const track of await resolver.prefetchSpotifyTimeline(rows))
        identity.remember(track);
      const review = new ReviewStore();
      await review.initialize(user, rows);
      const spotifyLinks = new SpotifyReviewLinks();
      await spotifyLinks.initialize(user, rows);
      const mappings = await savedMappings(user);
      const policy =
        state.deezerPolicyVersion === 1 && state.type === "deezer"
          ? await planDeezerRows(user, rows)
          : undefined;
      let estimated = state.estimated ?? 0;
      const issueCounts = state.issueCounts
        ? { ...state.issueCounts }
        : undefined;
      const summary = { ...emptySummary(), ...state.summary };
      const issues = [...(state.issues ?? [])];
      let savedIssueCount = issues.length;
      for (
        let index = state.summary ? state.current : 0;
        index < rows.length;
        index++
      ) {
        if (index === state.current || index % 100 === 0) {
          const batch = rows
            .slice(index, index + 100)
            .map((row, offset) =>
              policy?.duplicates.has(index + offset)
                ? undefined
                : (policy?.plans.get(index + offset)?.row ?? row),
            )
            .filter(
              (row): row is (typeof rows)[number] =>
                row !== undefined &&
                !review.isExcluded(row) &&
                !row.invalid &&
                !row.ambiguous &&
                Boolean(row.title && row.artist) &&
                ((row.listenedMs ?? 0) >= 30000 ||
                  Boolean(row.deezerPolicy && row.listenedMs === null)),
            );
          await identity.prefetchSourceTracks(user, batch);
          const unknown = batch.filter(
            (row) =>
              !identity.knownTrack(row) && !mappings.has(recordingKey(row)),
          );
          for (const track of await resolver.prefetchLegacyRecordings(unknown))
            identity.remember(track);
          await resolver.prefetch(unknown);
        }
        const plan = policy?.plans.get(index);
        const row = plan?.row ?? rows[index]!;
        identity.holdUnmatched = review.needsTimingReview(row);
        let outcome = "invalid";
        let reason: string | undefined;
        let category: ReviewCategory | undefined;
        const mapping = mappings.get(recordingKey(row));
        identity.reviewMapping =
          mapping && !mapping.noMatch && mapping.trackId
            ? { id: mapping.id, trackId: mapping.trackId }
            : undefined;
        let changedHistory = false;
        if (policy?.duplicates.has(index)) summary.duplicates++;
        else if (review.isExcluded(row) || spotifyLinks.isExcluded(row)) {
          summary.excluded++;
          outcome = "excluded";
        } else if (
          row.provider === "spotify" &&
          !row.invalid &&
          row.listenedMs !== null &&
          row.listenedMs < 30000
        ) {
          summary.short++;
          outcome = "short";
          await review.skippedShort(user, row, id);
        } else if (
          row.invalid ||
          !row.title ||
          !row.artist ||
          (row.listenedMs === null && !plan)
        ) {
          summary.invalid++;
          category = "invalid";
          reason = row.invalid ?? "Missing identity or invalid listening time";
        } else if (!plan && (row.ambiguous || review.isConflicting(row))) {
          summary.ambiguous++;
          category = "timestamp";
          reason = "Conflicting entries at the same source timestamp";
        } else if (row.listenedMs !== null && row.listenedMs < 30000) {
          summary.short++;
          outcome = "short";
        } else if (mapping?.noMatch) {
          const savedCategory = plan
            ? "recording"
            : await review.noMatch(user, row, id, mapping.id);
          if (savedCategory === "timestamp") {
            summary.ambiguous++;
            category = "timestamp";
            reason = "Overlapping exports disagree about this source event";
          } else {
            summary.noMatch++;
            outcome = "no-match";
          }
        } else if (
          row.source === "privacy" &&
          review.needsTimingReview(row) &&
          !identity.knownTrack(row)
        ) {
          // Later rows may claim nearby API plays. A reupload must not silently
          // turn an earlier timing decision into an additional listen.
          summary.ambiguous++;
          category = "legacy";
          reason = "Multiple or uncertain existing plays; left unchanged";
        } else {
          const track = mapping
            ? mapping.track
            : (identity.knownTrack(row) ?? (await resolver.resolve(row)));
          if (!track) {
            outcome = "unresolved";
            summary.unresolved++;
            category = "recording";
            reason = mapping
              ? "The saved recording choice is unavailable; review its Spotify link"
              : "No confident Spotify track match";
          } else if (
            row.listenedMs === null &&
            (!Number.isFinite(track.duration_ms) || track.duration_ms <= 0)
          ) {
            summary.invalid++;
            category = "invalid";
            reason = "Neither listening time nor song length is available";
          } else {
            await longWriteDbLock.lock();
            try {
              const result = await reconcileImport(
                user,
                row,
                track,
                id,
                index,
                identity,
              );
              summary[result.outcome]++;
              outcome = result.outcome;
              if (result.estimated) estimated++;
              summary.deltaMs += result.deltaMs;
              changedHistory =
                result.outcome === "added" || result.outcome === "updated";
              if (result.outcome === "ambiguous") {
                category = "legacy";
                reason = "Multiple or uncertain existing plays; left unchanged";
              } else if (!plan) {
                await review.accepted(user, row, id);
                await spotifyLinks.accepted(user, row);
              }
            } finally {
              longWriteDbLock.unlock();
            }
          }
        }
        if (plan) {
          await saveDeezerEvidence(user, plan, id, outcome, category, reason);
          if (category && issueCounts) issueCounts[category]++;
        } else if (reason && category) {
          category = await review.save(user, row, category, reason, id);
          if (issueCounts) issueCounts[category]++;
        }
        if (reason && issues.length < 100)
          issues.push({ row: index + 1, title: row.title, reason });
        // Mutations checkpoint immediately so their saved outcomes cannot be
        // overwritten by later rows. Rows without count/duration changes can safely
        // be replayed, so checkpoint them in small groups.
        if (
          changedHistory ||
          (index + 1) % 100 === 0 ||
          index === rows.length - 1
        ) {
          await ImporterStateModel.updateOne(
            { _id: id },
            {
              current: index + 1,
              summary,
              ...(policy ? { estimated } : {}),
              ...(issueCounts ? { issueCounts } : {}),
              ...(issues.length !== savedIssueCount ? { issues } : {}),
            },
          );
          savedIssueCount = issues.length;
        }
      }
      await ImporterStateModel.updateOne(
        { _id: id },
        { status: "success", stage: "complete" },
      );
      await UserModel.updateOne({ _id: user._id }, { lastImport: id });
      await Promise.all(
        state.metadata.map((file) => unlink(file).catch(() => {})),
      );
    } catch (error) {
      logger.error("Import failed", error);
      await ImporterStateModel.updateOne(
        { _id: id },
        {
          status: "failure",
          stage: "failed",
          error:
            error instanceof Error
              ? error.message
              : "Import failed; retry to resume",
        },
      );
    }
  } finally {
    releaseImportWork(userId);
  }
}
