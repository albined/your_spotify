import type { PipelineStage } from "mongoose";

import { statisticsTimezone } from "../../tools/allTimeStart";
import { statisticsFor } from "../listeningDuration";
import { User } from "../schemas/user";
import { diversityWindowDays } from "./diversityWindow";
import { overviewPlan, OverviewPeriod } from "./listeningOverviewBuckets";
import {
  DAY_MS,
  timelineBounds,
  TimelineBounds,
} from "./listeningTimelineTools";

export interface DiversityChange {
  _id: { artist: string; bucket: number };
  durationMs: number;
}

// Changes are grouped by artist and sample: add listening when it enters the
// trailing window, subtract it when it expires. Only active artists remain in
// the map. Recompute squares from their integer millisecond totals to avoid
// cancellation errors when a heavily played artist leaves the window.
export function artistDiversity(
  count: number,
  changes: { artist: string; bucket: number; durationMs: number }[],
) {
  const grouped = Array.from({ length: count + 1 }, () => [] as typeof changes);
  for (const change of changes) grouped[change.bucket]?.push(change);
  const totals = new Map<string, number>();
  return grouped.map((bucket) => {
    for (const { artist, durationMs } of bucket) {
      const next = (totals.get(artist) ?? 0) + durationMs;
      if (next > 0) totals.set(artist, next);
      else totals.delete(artist);
    }
    let total = 0;
    let squares = 0;
    for (const duration of totals.values()) {
      total += duration;
      squares += duration * duration;
    }
    return squares ? (total * total) / squares : 0;
  });
}

/**
 * The share of their listening each pair of people has in common at every
 * sample, from one person's window changes each. An artist counts as shared
 * up to the smaller of the two shares. Null while either has no listening.
 */
export function rollingOverlap(
  count: number,
  people: { artist: string; bucket: number; durationMs: number }[][],
) {
  const grouped = people.map((changes) => {
    const buckets = Array.from(
      { length: count + 1 },
      () => [] as typeof changes,
    );
    for (const change of changes) buckets[change.bucket]?.push(change);
    return buckets;
  });
  const active = people.map(() => new Map<string, number>());
  const pairs: { members: [number, number]; values: (number | null)[] }[] = [];
  for (let first = 0; first < people.length; first += 1)
    for (let second = first + 1; second < people.length; second += 1)
      pairs.push({ members: [first, second], values: [] });
  for (let bucket = 0; bucket <= count; bucket += 1) {
    const totals = active.map((artists, person) => {
      for (const { artist, durationMs } of grouped[person]![bucket]!) {
        const next = (artists.get(artist) ?? 0) + durationMs;
        if (next > 0) artists.set(artist, next);
        else artists.delete(artist);
      }
      let total = 0;
      for (const duration of artists.values()) total += duration;
      return total;
    });
    for (const { members, values } of pairs) {
      const [first, second] = members;
      if (!totals[first] || !totals[second]) {
        values.push(null);
        continue;
      }
      let shared = 0;
      for (const [artist, duration] of active[first]!) {
        const other = active[second]!.get(artist);
        if (other)
          shared += Math.min(
            duration / totals[first]!,
            other / totals[second]!,
          );
      }
      values.push(shared);
    }
  }
  return pairs;
}

export function artistDiversityStages(
  bounds: TimelineBounds,
  start: Date,
  windowMs: number,
): PipelineStage.FacetPipelineStage[] {
  // A play at s belongs to the sample at t exactly when t - windowMs <= s < t.
  // Derive entry/expiry indices from actual timestamps, independently of the
  // display resolution: no approximation using wide multi-year chart bins.
  const changeAt = (offset: number) => ({
    $max: [
      0,
      {
        $add: [
          1,
          {
            $floor: {
              $divide: [
                { $add: [{ $subtract: ["$played_at", start] }, offset] },
                bounds.width,
              ],
            },
          },
        ],
      },
    ],
  });
  return [
    { $match: { primaryArtistId: { $type: "string", $ne: "" } } },
    {
      $project: {
        artist: "$primaryArtistId",
        changes: [
          { bucket: changeAt(0), durationMs: "$durationMs" },
          {
            bucket: changeAt(windowMs),
            durationMs: { $multiply: ["$durationMs", -1] },
          },
        ],
      },
    },
    { $unwind: "$changes" },
    { $match: { "changes.bucket": { $lte: bounds.count } } },
    {
      $group: {
        _id: { artist: "$artist", bucket: "$changes.bucket" },
        durationMs: { $sum: "$changes.durationMs" },
      },
    },
  ];
}

export async function getPersonalArtistDiversity(
  user: User,
  start: Date,
  end: Date,
  period: OverviewPeriod = "custom",
) {
  const Statistics = statisticsFor(user);
  const plan = overviewPlan(start, end, period, statisticsTimezone(user));
  start = new Date(plan.start);
  const windowDays = diversityWindowDays(start, end);
  const windowMs = windowDays * DAY_MS;
  const cutoff = new Date(Math.min(end.getTime(), Date.now()));
  const bounds = timelineBounds(start, cutoff > start ? cutoff : end, 200);
  const changes =
    cutoff > start
      ? await Statistics.aggregate<DiversityChange>([
          {
            $match: {
              owner: user._id,
              played_at: {
                $gte: new Date(start.getTime() - windowMs),
                $lt: cutoff,
              },
              blacklistedBy: { $exists: false },
              durationMs: {
                $type: "number",
                $gt: 0,
                $lte: Number.MAX_SAFE_INTEGER,
              },
            },
          },
          ...artistDiversityStages(bounds, start, windowMs),
        ]).option({ maxTimeMS: 15_000, allowDiskUse: true })
      : [];
  return {
    ...bounds,
    timezone: statisticsTimezone(user),
    windowDays,
    values: artistDiversity(
      bounds.count,
      changes.map((row) => ({
        artist: row._id.artist,
        bucket: row._id.bucket,
        durationMs: row.durationMs,
      })),
    ).map((value) => value || null),
  };
}
