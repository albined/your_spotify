import { ImportRecord } from "../../tools/importers/records";
import {
  recordingKey,
  reviewHash,
  reviewRowKey,
} from "../../tools/importers/reviewIdentity";
import { ImportReviewModel } from "../Models";
import { ReviewCategory } from "../schemas/importReview";
import { User } from "../schemas/user";

export const validDeezerIdentity = (row: ImportRecord) =>
  row.source === "deezer" &&
  !row.invalid &&
  Boolean(row.title && row.artist) &&
  row.at instanceof Date &&
  Number.isFinite(row.at.getTime());
export const deezerEventKey = (row: ImportRecord) =>
  reviewHash(["deezer-event-v1", recordingKey(row), row.at]);

export interface DeezerPlan {
  row: ImportRecord;
  originals: Map<string, { row: ImportRecord; occurrences: number }>;
  winner: string;
  preserve: boolean;
  index: number;
}

/** Preserve original rows; choose one measured maximum per recording/timestamp. */
export async function planDeezerRows(user: User, rows: ImportRecord[]) {
  const groups = new Map<string, DeezerPlan>();
  const duplicates = new Set<number>();
  const add = (
    plan: DeezerPlan,
    row: ImportRecord,
    occurrences: number,
    current: boolean,
  ) => {
    const key = reviewRowKey(row);
    const old = plan.originals.get(key);
    plan.originals.set(key, {
      row,
      occurrences: current
        ? (old?.occurrences ?? 0) + 1
        : Math.max(old?.occurrences ?? 0, occurrences),
    });
    const winner = plan.originals.get(plan.winner)!.row;
    if (
      (row.listenedMs ?? -1) > (winner.listenedMs ?? -1) ||
      (row.listenedMs === winner.listenedMs && key < plan.winner)
    )
      plan.winner = key;
  };
  rows.forEach((row, index) => {
    if (!validDeezerIdentity(row)) return;
    const key = deezerEventKey(row);
    const plan = groups.get(key);
    if (plan) {
      add(plan, row, 1, true);
      plan.preserve = true;
      duplicates.add(index);
    } else
      groups.set(key, {
        row,
        index,
        originals: new Map([[reviewRowKey(row), { row, occurrences: 1 }]]),
        winner: reviewRowKey(row),
        preserve: row.listenedMs === null || Boolean(row.ambiguous),
      });
  });
  const previous = await ImportReviewModel.find({
    owner: user._id,
    "record.source": "deezer",
  })
    .select("record occurrences")
    .lean();
  for (const item of previous) {
    if (!validDeezerIdentity(item.record)) continue;
    const plan = groups.get(deezerEventKey(item.record));
    if (!plan) continue;
    plan.preserve = true;
    add(plan, item.record, item.occurrences, false);
  }
  const atTime = new Map<number, { keys: Set<string>; isrcs: Set<string> }>();
  for (const [key, plan] of groups) {
    const at = plan.row.at.getTime();
    const group = atTime.get(at) ?? {
      keys: new Set<string>(),
      isrcs: new Set<string>(),
    };
    group.keys.add(key);
    if (plan.row.isrc) group.isrcs.add(plan.row.isrc.trim().toUpperCase());
    atTime.set(at, group);
  }
  // Other saved recordings at these timestamps also protect legacy matches
  // when a later export contains only part of a timestamp group.
  for (const item of previous) {
    if (!validDeezerIdentity(item.record)) continue;
    const group = atTime.get(item.record.at.getTime());
    if (!group) continue;
    group.keys.add(deezerEventKey(item.record));
    if (item.record.isrc)
      group.isrcs.add(item.record.isrc.trim().toUpperCase());
  }
  const plans = new Map<number, DeezerPlan>();
  for (const [key, plan] of groups) {
    const winner = plan.originals.get(plan.winner)!.row;
    const timestamp = atTime.get(winner.at.getTime())!;
    plan.row = {
      ...winner,
      key,
      ambiguous: false,
      deezerPolicy: {
        sourceKeys: [
          ...new Set([
            key,
            ...[...plan.originals.values()].map(({ row }) => row.key),
          ]),
        ],
        timestampUncertain: timestamp.keys.size > 1,
        timestampIsrcs: [...timestamp.isrcs],
      },
    };
    plan.preserve ||= plan.row.deezerPolicy!.timestampUncertain;
    plans.set(plan.index, plan);
  }
  return { plans, duplicates };
}

/** Retain each original variant once, with only the selected row in the queue. */
export async function saveDeezerEvidence(
  user: User,
  plan: DeezerPlan,
  importId: string,
  outcome: string,
  category?: ReviewCategory,
  reason?: string,
) {
  if (!plan.preserve && !category && outcome !== "no-match") return;
  await ImportReviewModel.bulkWrite(
    [...plan.originals].map(([key, { row, occurrences }]) => {
      const winner = key === plan.winner;
      return {
        updateOne: {
          filter: { owner: user._id, key },
          update: {
            $set: {
              recordingKey: recordingKey(row),
              groupKey: recordingKey(row),
              category: winner && category ? category : "recording",
              status: !winner
                ? "resolved"
                : outcome === "no-match"
                  ? "no-match"
                  : category
                    ? "pending"
                    : "resolved",
              record: row,
              policyVersion: 1,
              lastImportId: importId,
              resolvedBy: importId,
              outcome: winner ? outcome : "duplicate",
              reason: winner
                ? (reason ??
                  (outcome === "excluded"
                    ? "Not added by your choice"
                    : row.listenedMs === null
                      ? "Song length used; listening time unknown"
                      : "Deezer recording/timestamp rule applied"))
                : "Duplicate recording at the same timestamp; longest reported duration retained",
            },
            $setOnInsert: { firstImportId: importId },
            $max: { occurrences },
          },
          upsert: true,
        },
      };
    }),
  );
}
