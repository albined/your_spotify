import { createHash } from "node:crypto";

import { ImportRecord } from "./records";

export const reviewHash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const normalized = (value = "") => value.normalize("NFKC").trim().toLowerCase();
export const recordingKey = (row: ImportRecord) =>
  reviewHash([
    row.provider,
    row.isrc?.trim()
      ? ["isrc", row.isrc.trim().toUpperCase()]
      : row.spotifyId
        ? ["spotify", row.spotifyId]
        : [
            "labels",
            normalized(row.title),
            normalized(row.artist),
            normalized(row.album),
          ],
  ]);
// A choice about one listen survives changed durations and source labels.
export const reviewEventKey = (row: ImportRecord) =>
  reviewHash(["review-event-v1", row.source, recordingKey(row), row.at]);
// Retain contradictory durations as separate evidence, deduplicating reuploads.
export const reviewRowKey = (row: ImportRecord) =>
  reviewHash([
    row.key,
    row.listenedMs,
    row.invalid ?? null,
    row.listenedMs === null ? row.sourceListeningTime : null,
    Number.isFinite(row.at?.getTime()) ? null : row.sourceTimestamp,
  ]);
