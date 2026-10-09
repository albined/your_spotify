import { ImportMappingModel } from "../../database/Models";
import { planDeezerRows } from "../../database/queries/deezerRules";
import { ImportContext } from "../../database/queries/importContext";
import { reconcileImport } from "../../database/queries/importListening";
import {
  markNoMatch,
  pendingRecording,
  reopenNoMatch,
  resolveReviewRow,
} from "../../database/queries/importReview";
import {
  getTimingReview,
  resolveTimingReview,
} from "../../database/queries/importTiming";
import { Track } from "../../database/schemas/track";
import { User } from "../../database/schemas/user";
import { backupBeforeReview } from "../backups";
import { longWriteDbLock } from "../lock";
import { selectedTrack } from "./reviewCatalog";
import { reviewHash } from "./reviewIdentity";
import { canUserImport, claimImportWork, releaseImportWork } from "./work";

// The pending rows of one recording, with the checks every choice must pass.
async function pendingChoice(user: User, group: string, track: Track) {
  const rows = await pendingRecording(user, group);
  if (!rows.length)
    throw new Error(
      "This recording has no pending items. Refresh the review list.",
    );
  const policyRows = rows.filter((item) => item.policyVersion === 1);
  if (policyRows.length) {
    const policy = await planDeezerRows(
      user,
      policyRows.map((item) => item.record),
    );
    for (const [index, plan] of policy.plans)
      policyRows[index]!.record = plan.row;
  }
  const mapping = await ImportMappingModel.findOne({
    owner: user._id,
    recordingKey: group,
  }).lean();
  if (mapping && mapping.trackId !== track.id)
    throw new Error(
      "A different recording choice is already saved for this group",
    );
  const timestamps = new Map<string, number>();
  for (const item of rows) {
    const key = reviewHash([item.record.source, item.record.at]);
    timestamps.set(key, (timestamps.get(key) ?? 0) + 1);
  }
  const blocked = new Set(
    rows
      .filter(
        (item) =>
          timestamps.get(reviewHash([item.record.source, item.record.at]))! > 1,
      )
      .map((item) => item._id.toString()),
  );
  return { rows, blocked, mapping };
}

export async function chooseNoMatch(user: User, group: string, reopen = false) {
  const userId = user._id.toString();
  claimImportWork(userId);
  try {
    await backupBeforeReview();
    await longWriteDbLock.lock();
    try {
      if (reopen) await reopenNoMatch(user, group);
      else await markNoMatch(user, group);
      return { saved: true };
    } finally {
      longWriteDbLock.unlock();
    }
  } finally {
    releaseImportWork(userId);
  }
}

export async function applyReview(user: User, group: string, id: string) {
  const userId = user._id.toString();
  claimImportWork(userId);
  try {
    const track = await selectedTrack(userId, id);
    // Review changes follow the import backup policy; one backup covers a sitting.
    await backupBeforeReview();
    await longWriteDbLock.lock();
    try {
      // A choice is applied to history as it is now, under the write lock.
      const plan = await pendingChoice(user, group, track);
      const mapping =
        plan.mapping ??
        (await ImportMappingModel.create({
          owner: user._id,
          recordingKey: group,
          trackId: id,
          sourceTitle: plan.rows[0]!.record.title,
          sourceArtist: plan.rows[0]!.record.artist,
        }));
      const identity = new ImportContext();
      const mappingId = mapping._id.toString();
      identity.reviewMapping = { id: mappingId, trackId: id };
      const summary = {
        added: 0,
        updated: 0,
        unchanged: 0,
        ambiguous: 0,
        deltaMs: 0,
      };
      for (const item of plan.rows) {
        // Stable row IDs make a retry recover a play committed before its queue update.
        const result = plan.blocked.has(item._id.toString())
          ? { outcome: "ambiguous" as const, deltaMs: 0 }
          : await reconcileImport(
              user,
              item.record,
              track,
              `review:${mappingId}`,
              item._id.toString(),
              identity,
            );
        await resolveReviewRow(
          user,
          item,
          mappingId,
          result.outcome,
          result.deltaMs,
        );
        summary[result.outcome]++;
        summary.deltaMs += result.deltaMs;
      }
      return { summary };
    } finally {
      longWriteDbLock.unlock();
    }
  } finally {
    releaseImportWork(userId);
  }
}

export async function reviewTiming(user: User, group: string) {
  if (!canUserImport(user._id.toString()))
    throw new Error("Wait for the current import or review to finish");
  await longWriteDbLock.lock();
  try {
    return await getTimingReview(user, group);
  } finally {
    longWriteDbLock.unlock();
  }
}

export async function applyTimingChoice(
  user: User,
  group: string,
  rowId: string,
  token: string,
  existingId: string | null,
  exclude = false,
) {
  const userId = user._id.toString();
  claimImportWork(userId);
  try {
    await backupBeforeReview();
    await longWriteDbLock.lock();
    try {
      return await resolveTimingReview(
        user,
        group,
        rowId,
        token,
        existingId,
        exclude,
      );
    } finally {
      longWriteDbLock.unlock();
    }
  } finally {
    releaseImportWork(userId);
  }
}
