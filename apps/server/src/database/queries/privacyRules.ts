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
    this.links.clear();
    const valid = (row: ImportRecord) =>
      row.provider === "spotify" &&
      !row.invalid &&
      Number.isFinite(row.at?.getTime()) &&
      (row.listenedMs ?? 0) >= 30000;
    const incoming = rows.filter((row) => valid(row) && !row.ambiguous);
    if (!incoming.length) return;
    const fromExtended = incoming[0]!.source === "full-privacy";
    const identities = new Set(incoming.map(minuteIdentity));
    const previous = (
      await ImportReviewModel.find({
        owner: user._id,
        ...(fromExtended
          ? {
              "record.source": "privacy",
              $or: [
                { status: { $in: ["pending", "no-match"] } },
                { excluded: true },
              ],
            }
          : { "record.source": "full-privacy", excluded: true }),
      }).lean()
    ).filter(
      (item) =>
        valid(item.record) && identities.has(minuteIdentity(item.record)),
    );
    if (!previous.length) return;
    const byIdentity = new Map<string, ImportReview[]>();
    for (const item of previous) {
      const key = minuteIdentity(item.record);
      byIdentity.set(key, [...(byIdentity.get(key) ?? []), item]);
    }

    const minutes = previous.map((item) => Math.floor(+item.record.at / 60000));
    const range = {
      $gte: new Date(minutes.reduce((a, b) => Math.min(a, b)) * 60000),
      $lt: new Date((minutes.reduce((a, b) => Math.max(a, b)) + 1) * 60000),
    };
    // Include resolved/excluded evidence too: deciding A cannot erase competitor B.
    const evidence = await ImportReviewModel.find({
      owner: user._id,
      "record.source": "full-privacy",
      "record.at": range,
    })
      .select("record")
      .lean();
    const precise = new Map<string, Set<string>>();
    const knownKeys = new Set<string>();
    for (const row of [...rows, ...evidence.map((item) => item.record)]) {
      if (row.source !== "full-privacy" || !valid(row)) continue;
      knownKeys.add(row.key);
      const identity = minuteIdentity(row);
      const entries = precise.get(identity) ?? new Set<string>();
      entries.add(row.key);
      precise.set(identity, entries);
    }
    const saved = await InfosModel.find({
      owner: user._id,
      listeningSource: "full-privacy",
      sourceEndedAt: range,
      listenedMs: { $in: previous.map((item) => item.record.listenedMs) },
    })
      .select("sourceKeys sourceEndedAt listenedMs")
      .lean();
    const minuteDuration = (at: Date, ms: number | null | undefined) =>
      `${Math.floor(+at / 60000)}:${ms}`;
    const unknown = new Set(
      saved
        .filter((play) => !play.sourceKeys?.some((key) => knownKeys.has(key)))
        .map((play) => minuteDuration(play.sourceEndedAt!, play.listenedMs)),
    );
    // Accepted plays may no longer have raw export labels. Without that evidence,
    // another precise play in the same minute/duration prevents proving uniqueness.
    for (const row of incoming) {
      const identity = minuteIdentity(row);
      const entries = precise.get(identity);
      if (
        entries?.size !== 1 ||
        unknown.has(minuteDuration(row.at, row.listenedMs))
      )
        continue;
      const [key] = entries;
      if (fromExtended && key !== row.key) continue;
      const linked = (byIdentity.get(identity) ?? []).filter(
        (item) => fromExtended || item.record.key === key,
      );
      if (linked.length) this.links.set(row.key, linked);
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
