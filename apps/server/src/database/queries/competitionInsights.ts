import { Types } from "mongoose";

import { statisticsTimezone } from "../../tools/allTimeStart";
import { statisticsFor } from "../listeningDuration";
import { User } from "../schemas/user";
import {
  artistDiversity,
  artistDiversityStages,
  DiversityChange,
  rollingOverlap,
} from "./artistDiversity";
import { requireCompetitionParticipants } from "./competitionParticipants";
import { diversityWindowDays, overlapWindowDays } from "./diversityWindow";
import { DAY_MS, timelineBounds } from "./listeningTimelineTools";

export { artistDiversity } from "./artistDiversity";

export async function getCompetitionInsights(
  user: User,
  userIds: string[],
  start: Date,
  end: Date,
) {
  const Statistics = statisticsFor(user);
  const accounts = await requireCompetitionParticipants(userIds);
  const windowDays = diversityWindowDays(start, end);
  const windowMs = windowDays * DAY_MS;
  // Only two or three people are compared pair by pair, as in the Venn diagram.
  const overlapDays =
    accounts.length === 2 || accounts.length === 3
      ? overlapWindowDays(start, end)
      : 0;
  const overlapMs = overlapDays * DAY_MS;
  const cutoff = new Date(Math.min(end.getTime(), Date.now()));
  // Do not extrapolate rolling diversity into a future part of a date range.
  const bounds = timelineBounds(start, cutoff > start ? cutoff : end, 200);
  const changes = (rows: DiversityChange[] = []) =>
    rows.map((row) => ({
      artist: row._id.artist,
      bucket: row._id.bucket,
      durationMs: row.durationMs,
    }));
  const load = async (account: (typeof accounts)[number]) => {
    // Hour-of-day uses each participant's local clock, for comparing habits.
    const timezone = statisticsTimezone(account);
    const [result] = await Statistics.aggregate<{
      artists: DiversityChange[];
      overlap?: DiversityChange[];
      hours: { _id: number; hours: number }[];
    }>([
      {
        $match: {
          owner: new Types.ObjectId(account._id),
          played_at: {
            $gte: new Date(start.getTime() - Math.max(windowMs, overlapMs)),
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
            // Each chart warms up over its own window only.
            {
              $match: {
                played_at: { $gte: new Date(start.getTime() - windowMs) },
              },
            },
            ...artistDiversityStages(bounds, start, windowMs),
          ],
          ...(overlapMs
            ? { overlap: artistDiversityStages(bounds, start, overlapMs) }
            : {}),
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
          ? artistDiversity(bounds.count, changes(result?.artists))
          : Array<number>(bounds.count + 1).fill(0),
      overlap: changes(result?.overlap),
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
  return {
    ...bounds,
    windowDays,
    timezone: statisticsTimezone(user),
    series: rows.map(({ overlap: _, ...person }) => person),
    overlap:
      overlapMs && cutoff > start
        ? {
            windowDays: overlapDays,
            pairs: rollingOverlap(
              bounds.count,
              rows.map((person) => person.overlap),
            ),
          }
        : null,
  };
}
