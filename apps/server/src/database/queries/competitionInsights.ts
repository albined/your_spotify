import { Types } from "mongoose";

import { statisticsTimezone } from "../../tools/allTimeStart";
import { InfosModel } from "../Models";
import { User } from "../schemas/user";
import { requireCompetitionParticipants } from "./competitionParticipants";
import { DAY_MS, timelineBounds } from "./listeningTimelineTools";

export const DIVERSITY_WINDOW_MS = 30 * DAY_MS;

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

export async function getCompetitionInsights(
  user: User,
  userIds: string[],
  start: Date,
  end: Date,
) {
  const accounts = await requireCompetitionParticipants(userIds);
  const cutoff = new Date(Math.min(end.getTime(), Date.now()));
  // Do not extrapolate rolling diversity into a future part of a date range.
  const bounds = timelineBounds(start, cutoff > start ? cutoff : end, 200);
  const load = async (account: (typeof accounts)[number]) => {
    // Hour-of-day uses each participant's local clock, for comparing habits.
    const timezone = statisticsTimezone(account);
    // A play at s belongs to the sample at t exactly when t - 30d <= s < t.
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
    const [result] = await InfosModel.aggregate<{
      artists: {
        _id: { artist: string; bucket: number };
        durationMs: number;
      }[];
      hours: { _id: number; hours: number }[];
    }>([
      {
        $match: {
          owner: new Types.ObjectId(account._id),
          played_at: {
            $gte: new Date(start.getTime() - DIVERSITY_WINDOW_MS),
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
      {
        $facet: {
          artists: [
            { $match: { primaryArtistId: { $type: "string", $ne: "" } } },
            {
              $project: {
                artist: "$primaryArtistId",
                changes: [
                  { bucket: changeAt(0), durationMs: "$durationMs" },
                  {
                    bucket: changeAt(DIVERSITY_WINDOW_MS),
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
          ],
          hours: [
            // The warm-up history belongs only to diversity, not this histogram.
            { $match: { played_at: { $gte: start } } },
            {
              $group: {
                _id: { $hour: { date: "$played_at", timezone } },
                hours: { $sum: { $divide: ["$durationMs", 3600000] } },
              },
            },
          ],
        },
      },
    ]).option({ maxTimeMS: 15000, allowDiskUse: true });
    const hours = Array<number>(24).fill(0);
    for (const row of result?.hours ?? []) hours[row._id] = row.hours;
    const total = hours.reduce((sum, value) => sum + value, 0);
    return {
      id: account._id.toHexString(),
      name: account.username,
      values:
        cutoff > start
          ? artistDiversity(
              bounds.count,
              (result?.artists ?? []).map((row) => ({
                artist: row._id.artist,
                bucket: row._id.bucket,
                durationMs: row.durationMs,
              })),
            )
          : Array<number>(bounds.count + 1).fill(0),
      hours,
      percentages: hours.map((value) => (total ? (100 * value) / total : 0)),
    };
  };
  const rows: Awaited<ReturnType<typeof load>>[] = [];
  for (let offset = 0; offset < accounts.length; offset += 4) {
    rows.push(
      ...(await Promise.all(accounts.slice(offset, offset + 4).map(load))),
    );
  }
  return { ...bounds, timezone: statisticsTimezone(user), series: rows };
}
