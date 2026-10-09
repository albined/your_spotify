import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import * as XLSX from "xlsx";
import { z } from "zod";

export type ImportSource = "privacy" | "full-privacy" | "deezer";
export interface ImportRecord {
  key: string;
  source: ImportSource;
  provider: "spotify" | "deezer";
  at: Date;
  precisionMs: number;
  listenedMs: number | null;
  spotifyId?: string;
  title: string;
  artist: string;
  album?: string;
  sourceTimestamp?: string;
  sourceListeningTime?: string;
  isrc?: string;
  invalid?: string;
  ambiguous?: boolean;
  // Derived after checking the original export fingerprint; never replaces raw evidence.
  deezerPolicy?: {
    sourceKeys: string[];
    timestampUncertain: boolean;
    timestampIsrcs: string[];
  };
}

const fullSchema = z.array(
  z.object({
    ts: z.string(),
    ms_played: z.number(),
    spotify_track_uri: z.string().nullable(),
    master_metadata_track_name: z.string().nullable(),
    master_metadata_album_artist_name: z.string().nullable(),
    master_metadata_album_album_name: z.string().nullable().optional(),
  }),
);
const privacySchema = z.array(
  z.object({
    endTime: z.string(),
    msPlayed: z.number(),
    trackName: z.string(),
    artistName: z.string(),
  }),
);

const dateFormatters = new Map<string, Intl.DateTimeFormat>();

/** Reject ambiguous/nonexistent DST wall times instead of guessing. */
export function parseExportDate(value: string, timezone = "UTC") {
  if (/(Z|[+-]\d\d:\d\d)$/.test(value)) {
    return new Date(
      z.iso.datetime({ offset: true }).safeParse(value).success ? value : NaN,
    );
  }
  const wall = value.trim().replace(" ", "T");
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d(:\d\d)?$/.test(wall)) return new Date(NaN);
  const normalized = wall.length === 16 ? `${wall}:00` : wall;
  const nominal = Date.parse(`${normalized}Z`);
  if (!Number.isFinite(nominal)) return new Date(NaN);
  if (timezone === "UTC") {
    return new Date(
      Number.isFinite(nominal) &&
        new Date(nominal).toISOString().slice(0, 19) === normalized
        ? nominal
        : NaN,
    );
  }
  const fmt =
    dateFormatters.get(timezone) ??
    new Intl.DateTimeFormat("sv-SE", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
  dateFormatters.set(timezone, fmt);
  const candidates = new Set<number>();
  // Sampling either side of a transition finds both possible UTC offsets.
  for (const shift of [-86400000, 0, 86400000]) {
    const probe = nominal + shift;
    const rendered = fmt.format(probe).replace(" ", "T");
    const offset = Date.parse(`${rendered}Z`) - probe;
    const candidate = nominal - offset;
    if (fmt.format(candidate).replace(" ", "T") === normalized)
      candidates.add(candidate);
  }
  return new Date(candidates.size === 1 ? [...candidates][0]! : NaN);
}

function record(
  source: ImportSource,
  at: Date,
  ms: number,
  title: string,
  artist: string,
  identity: string,
  extras: Partial<ImportRecord> = {},
): ImportRecord {
  const validTime = Number.isFinite(at.getTime());
  return {
    source,
    provider: source === "deezer" ? "deezer" : "spotify",
    at,
    precisionMs: source === "privacy" ? 60000 : 1000,
    listenedMs: Number.isSafeInteger(ms) && ms >= 0 ? ms : null,
    title,
    artist,
    // Duration is deliberately excluded so corrected exports update the same event.
    key: createHash("sha256")
      .update(
        JSON.stringify([
          source,
          identity,
          validTime ? at.toISOString() : "invalid",
        ]),
      )
      .digest("hex"),
    ...(!validTime ? { invalid: "Invalid or ambiguous timestamp" } : {}),
    ...extras,
  };
}

export function privacySourceKey(row: ImportRecord) {
  return record(
    "privacy",
    new Date(Math.floor(row.at.getTime() / 60000) * 60000),
    row.listenedMs ?? NaN,
    row.title,
    row.artist,
    JSON.stringify([row.title, row.artist]),
  ).key;
}

export async function readImportRecords(
  source: ImportSource,
  files: string[],
  timezone = "UTC",
) {
  const records: ImportRecord[] = [];
  for (const file of files) {
    const bytes = await readFile(file);
    if (source === "deezer") {
      const workbook = XLSX.read(bytes, { type: "buffer" });
      const sheet = workbook.Sheets["10_listeningHistory"];
      if (!sheet) throw new Error("Missing 10_listeningHistory worksheet");
      const rows = XLSX.utils.sheet_to_json(sheet) as Record<string, unknown>[];
      if (rows.length && !("Listening Time" in rows[0]!))
        throw new Error("Missing Listening Time column");
      for (const row of rows) {
        const title = String(row["Song Title"] ?? "");
        const artist = String(row.Artist ?? "");
        const isrc = String(row.ISRC ?? "");
        const rawTime = row["Listening Time"];
        const seconds =
          rawTime === "" || rawTime == null ? NaN : Number(rawTime);
        records.push(
          record(
            source,
            parseExportDate(String(row.Date ?? ""), timezone),
            seconds * 1000,
            title,
            artist,
            JSON.stringify([isrc, title, artist]),
            {
              isrc,
              album: String(row["Album Title"] ?? ""),
              sourceTimestamp: String(row.Date ?? ""),
              sourceListeningTime: String(rawTime ?? ""),
            },
          ),
        );
      }
    } else if (source === "full-privacy") {
      for (const row of fullSchema.parse(JSON.parse(bytes.toString()))) {
        const spotifyId = /^spotify:track:([a-zA-Z0-9]+)$/.exec(
          row.spotify_track_uri ?? "",
        )?.[1];
        records.push(
          record(
            source,
            parseExportDate(row.ts),
            row.ms_played,
            row.master_metadata_track_name ?? "",
            row.master_metadata_album_artist_name ?? "",
            row.spotify_track_uri ?? "",
            {
              spotifyId,
              album: row.master_metadata_album_album_name ?? undefined,
              sourceTimestamp: row.ts,
              sourceListeningTime: String(row.ms_played),
              ...(!spotifyId
                ? { invalid: "Unsupported or unavailable track" }
                : {}),
            },
          ),
        );
      }
    } else {
      for (const row of privacySchema.parse(JSON.parse(bytes.toString()))) {
        records.push(
          record(
            source,
            parseExportDate(row.endTime),
            row.msPlayed,
            row.trackName,
            row.artistName,
            JSON.stringify([row.trackName, row.artistName]),
            {
              sourceTimestamp: row.endTime,
              sourceListeningTime: String(row.msPlayed),
            },
          ),
        );
      }
    }
  }
  if (!records.length)
    throw new Error("The files contain no listening history");
  const durations = new Map<string, number | null>();
  const conflicts = new Set<string>();
  const timestampKeys = new Map<number, Set<string>>();
  for (const row of records) {
    if (durations.has(row.key) && durations.get(row.key) !== row.listenedMs)
      conflicts.add(row.key);
    durations.set(row.key, row.listenedMs);
    if (source === "deezer" && !row.invalid && (row.listenedMs ?? 0) >= 30000) {
      const time = row.at.getTime();
      const keys = timestampKeys.get(time) ?? new Set<string>();
      keys.add(row.key);
      timestampKeys.set(time, keys);
    }
  }
  // Some Deezer exports assign one timestamp to a batch of different songs.
  // Classify the whole group before reconciliation so results do not depend
  // on file order or on whether a legacy play was corrected by an earlier row.
  for (const keys of timestampKeys.values())
    if (keys.size > 1) for (const key of keys) conflicts.add(key);
  return records.map((row) =>
    conflicts.has(row.key) ? { ...row, ambiguous: true } : row,
  );
}

export function importRange(records: ImportRecord[]) {
  const times = records.map((r) => r.at.getTime()).filter(Number.isFinite);
  return {
    start: times.length
      ? new Date(times.reduce((a, b) => Math.min(a, b))).toISOString()
      : null,
    end: times.length
      ? new Date(times.reduce((a, b) => Math.max(a, b))).toISOString()
      : null,
  };
}

export function importFingerprint(records: ImportRecord[], version = 1) {
  if (version >= 2)
    return createHash("sha256").update(JSON.stringify(records)).digest("hex");
  // Preserve fingerprints of already prepared jobs when optional display metadata grows.
  return createHash("sha256")
    .update(
      JSON.stringify(
        records.map(
          ({
            album: _album,
            sourceTimestamp: _at,
            sourceListeningTime: _time,
            ...row
          }) => row,
        ),
      ),
    )
    .digest("hex");
}
