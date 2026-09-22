import { Types } from "mongoose";

import { statisticsTimezone } from "../../tools/allTimeStart";
import { InfosModel } from "../Models";
import { User } from "../schemas/user";
import { requireCompetitionParticipants } from "./competitionParticipants";
import { bucketExpression, timelineBounds } from "./listeningTimelineTools";

// Inverse Simpson: 1 / sum(p_i²). Expressed as effective artists, weighted by
// duration. Update squared totals incrementally instead of rescanning artists
// for each point. Cumulative diversity can fall when listening concentrates.
export function artistDiversity(
  count: number,
  rows: { artist: string; bucket: number; hours: number }[],
) {
  const grouped = Array.from({ length: count }, () => [] as typeof rows);
  for (const row of rows) grouped[row.bucket]?.push(row);
  const totals = new Map<string, number>();
  let total = 0;
  let squares = 0;
  return [
    0,
    ...grouped.map((bucket) => {
      for (const { artist, hours } of bucket) {
        if (!Number.isFinite(hours) || hours <= 0) continue;
        const previous = totals.get(artist) ?? 0;
        squares += 2 * previous * hours + hours * hours;
        total += hours;
        totals.set(artist, previous + hours);
      }
      return squares ? (total * total) / squares : 0;
    }),
  ];
}

export async function getCompetitionInsights(
  user: User,
  userIds: string[],
  start: Date,
  end: Date,
) {
  const accounts = await requireCompetitionParticipants(userIds);
  const bounds = timelineBounds(start, end, 200);
  const load = async (account: (typeof accounts)[number]) => {
    // Hour-of-day uses each participant's local clock, for comparing habits.
    const timezone = statisticsTimezone(account);
    const [result] = await InfosModel.aggregate<{
      artists: { _id: { artist: string; bucket: number }; hours: number }[];
      hours: { _id: number; hours: number }[];
    }>([
      {
        $match: {
          owner: new Types.ObjectId(account._id),
          played_at: {
            $gte: start,
            $lt: new Date(Math.min(end.getTime(), Date.now())),
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
              $group: {
                _id: {
                  artist: "$primaryArtistId",
                  bucket: bucketExpression(bounds),
                },
                hours: { $sum: { $divide: ["$durationMs", 3600000] } },
              },
            },
          ],
          hours: [
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
      values: artistDiversity(
        bounds.count,
        (result?.artists ?? []).map((row) => ({
          artist: row._id.artist,
          bucket: row._id.bucket,
          hours: row.hours,
        })),
      ),
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
