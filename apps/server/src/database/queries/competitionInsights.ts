import { Types } from "mongoose";

import { statisticsTimezone } from "../../tools/allTimeStart";
import { User } from "../schemas/user";
import { StatisticsInfosModel } from "../StatisticsInfos";
import {
  artistDiversity,
  artistDiversityStages,
  DIVERSITY_WINDOW_MS,
} from "./artistDiversity";
import { requireCompetitionParticipants } from "./competitionParticipants";
import { timelineBounds } from "./listeningTimelineTools";

export { artistDiversity, DIVERSITY_WINDOW_MS } from "./artistDiversity";

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
    const [result] = await StatisticsInfosModel.aggregate<{
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
          artists: artistDiversityStages(bounds, start),
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
