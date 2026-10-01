import { ImportRecord } from "../../tools/importers/records";
import {
  recordingKey,
  reviewRowKey,
} from "../../tools/importers/reviewIdentity";
import { ImportReviewModel, InfosModel } from "../Models";
import { ImportReview } from "../schemas/importReview";
import { User } from "../schemas/user";

const short = (row: ImportRecord) =>
  !row.invalid && row.listenedMs !== null && row.listenedMs < 30000;

/** Spotify can report completed plays and short skips at the same timestamp. */
export async function planSpotifyRows(
  user: User,
  rows: ImportRecord[],
  importId: string,
) {
  const pending = await ImportReviewModel.find({
    owner: user._id,
    $or: [
      { status: { $in: ["pending", "no-match"] } },
      { status: "resolved", outcome: "extended-export" },
    ],
    "record.source": { $in: ["privacy", "full-privacy"] },
    "record.key": { $in: [...new Set(rows.map((row) => row.key))] },
  }).lean();
  const superseded = new Map(
    pending
      .filter((item) => item.outcome === "extended-export" && item.resolvedBy)
      .map((item) => [item.key, item.resolvedBy!]),
  );
  const linked = new Set(
    (
      await InfosModel.find({
        owner: user._id,
        sourceKeys: { $in: [...superseded.values()], $type: "string" },
        listeningSource: "full-privacy",
      })
        .select("sourceKeys")
        .lean()
    ).flatMap((play) => play.sourceKeys ?? []),
  );
  const durations = new Map<string, Set<number | null>>();
  for (const row of [...rows, ...pending.map((item) => item.record)]) {
    if (short(row)) continue;
    const values = durations.get(row.key) ?? new Set<number | null>();
    values.add(row.listenedMs);
    durations.set(row.key, values);
  }
  const conflicting = (row: ImportRecord) =>
    !short(row) && (durations.get(row.key)?.size ?? 0) > 1;
  // Reuploads also repair review items produced before skips were excluded.
  // Keep the evidence; only remove it from the queue when it cannot count.
  const changes = pending
    .filter(
      (item) => item.category === "timestamp" && !conflicting(item.record),
    )
    .map((item) => ({
      updateOne: {
        filter: { _id: item._id, owner: user._id, status: "pending" as const },
        update: {
          $set: short(item.record)
            ? {
                status: "resolved" as const,
                outcome: "short",
                resolvedBy: importId,
                reason: "Below the 30-second listening threshold",
              }
            : {
                category: "recording" as const,
                groupKey: recordingKey(item.record),
                "record.ambiguous": false,
                reason: "Ready to match after excluding short plays",
              },
        },
      },
    }));
  if (changes.length) await ImportReviewModel.bulkWrite(changes);
  // Applied after the original upload fingerprint has been checked.
  return rows.map((row) => {
    const key = superseded.get(reviewRowKey(row));
    // An older minute row can refer directly to its accepted precise event.
    // Do not attach its shared minute key to two different listens.
    return key && linked.has(key)
      ? { ...row, key, ambiguous: false }
      : { ...row, ambiguous: conflicting(row) };
  });
}

const minuteIdentity = (row: ImportRecord) =>
  JSON.stringify([
    Math.floor(row.at.getTime() / 60000),
    row.title.normalize("NFKC").trim().toLowerCase(),
    row.artist.normalize("NFKC").trim().toLowerCase(),
    row.listenedMs,
  ]);

/** Retire standard-export questions only when one precise event proves the answer. */
export class SpotifyReviewLinks {
  private links = new Map<string, ImportReview[]>();
  async initialize(user: User, rows: ImportRecord[]) {
    const precise = new Map<string, Map<string, ImportRecord>>();
    for (const row of rows) {
      if (
        row.provider !== "spotify" ||
        row.invalid ||
        row.ambiguous ||
        (row.listenedMs ?? 0) < 30000
      )
        continue;
      const identity = minuteIdentity(row);
      const entries = precise.get(identity) ?? new Map();
      entries.set(row.key, row);
      precise.set(identity, entries);
    }
    if (!precise.size) return;
    const previous = await ImportReviewModel.find({
      owner: user._id,
      ...(rows[0]?.source === "full-privacy"
        ? {
            "record.source": "privacy",
            $or: [
              { status: { $in: ["pending", "no-match"] } },
              { excluded: true },
            ],
          }
        : { "record.source": "full-privacy", excluded: true }),
    }).lean();
    for (const item of previous) {
      const entries = precise.get(minuteIdentity(item.record));
      if (entries?.size !== 1) continue;
      const key = [...entries.keys()][0]!;
      this.links.set(key, [...(this.links.get(key) ?? []), item]);
    }
  }
  isExcluded(row: ImportRecord) {
    return this.links.get(row.key)?.some((item) => item.excluded) ?? false;
  }
  async accepted(user: User, row: ImportRecord, excluded = false) {
    if (row.source !== "full-privacy") return;
    const linked = this.links.get(row.key);
    if (!linked?.length) return;
    await ImportReviewModel.updateMany(
      {
        owner: user._id,
        key: { $in: linked.map((item) => item.key) },
        excluded: { $ne: true },
      },
      {
        $set: {
          status: "resolved",
          outcome: excluded ? "excluded" : "extended-export",
          ...(excluded ? { excluded: true } : {}),
          resolvedBy: row.key,
          reason: excluded
            ? "Not added by your choice"
            : "Matched by Spotify ID, precise timestamp and listening time in the extended export",
        },
      },
    );
    this.links.delete(row.key);
  }
}
