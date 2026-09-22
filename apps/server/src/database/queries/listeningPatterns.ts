import { getWithDefault } from "../../tools/env";
import { User } from "../schemas/user";
import { StatisticsInfosModel } from "../StatisticsInfos";
import { getStatisticsArtists } from "./artistGroups";
import { DAY_MS, HOUR_MS } from "./listeningTimelineTools";

function context(user: User, start: Date, end: Date) {
  return {
    timezone:
      user.settings.timezone ?? getWithDefault("TIMEZONE", "Europe/Paris"),
    match: {
      owner: user._id,
      played_at: { $gte: start, $lt: end },
      blacklistedBy: { $exists: false },
      durationMs: { $type: "number", $gt: 0, $lte: Number.MAX_SAFE_INTEGER },
    },
  };
}

export async function getListeningHeatmaps(user: User, start: Date, end: Date) {
  const { timezone, match } = context(user, start, end);
  const [result] = await StatisticsInfosModel.aggregate<{
    days: { _id: string; hours: number }[];
    rhythms: { _id: { weekday: number; hour: number }; hours: number }[];
  }>([
    { $match: match },
    {
      $facet: {
        days: [
          {
            $group: {
              _id: {
                $dateToString: {
                  date: "$played_at",
                  format: "%Y-%m-%d",
                  timezone,
                },
              },
              hours: { $sum: { $divide: ["$durationMs", HOUR_MS] } },
            },
          },
          { $sort: { _id: 1 } },
        ],
        rhythms: [
          {
            $group: {
              _id: {
                weekday: { $isoDayOfWeek: { date: "$played_at", timezone } },
                hour: { $hour: { date: "$played_at", timezone } },
              },
              hours: { $sum: { $divide: ["$durationMs", HOUR_MS] } },
            },
          },
        ],
      },
    },
  ]).option({ maxTimeMS: 15_000, allowDiskUse: true });
  return {
    start: start.getTime(),
    end: end.getTime(),
    timezone,
    days: (result?.days ?? []).map((day) => ({
      date: day._id,
      hours: day.hours,
    })),
    rhythms: (result?.rhythms ?? []).map((cell) => ({
      ...cell._id,
      hours: cell.hours,
    })),
  };
}

// Date strings represent local calendar dates. UTC here is only an ordinal for
// counting dates: a DST day still counts as one day, not 23/24 or 25/24 days.
export function summarizeArtistDays(days: { date: string; hours: number }[]) {
  const ordered = days
    .filter((day) => day.hours > 0)
    .sort((a, b) => a.date.localeCompare(b.date));
  let left = 0;
  let sum = 0;
  let peakHours = 0;
  for (let right = 0; right < ordered.length; right++) {
    const current = ordered[right]!;
    sum += current.hours;
    while (
      Date.parse(current.date) - Date.parse(ordered[left]!.date) >=
      7 * DAY_MS
    ) {
      sum -= ordered[left++]!.hours;
    }
    peakHours = Math.max(peakHours, sum);
  }
  return { activeDays: ordered.length, peakHoursPerDay: peakHours / 7 };
}

export async function getArtistActivity(user: User, start: Date, end: Date) {
  const { timezone, match } = context(user, start, end);
  const base = { start: start.getTime(), end: end.getTime(), timezone };
  if (end.getTime() - start.getTime() < 7 * DAY_MS)
    return { ...base, artists: [] };
  const totals = await StatisticsInfosModel.aggregate<{
    _id: string;
    hours: number;
  }>([
    { $match: { ...match, primaryArtistId: { $type: "string", $ne: "" } } },
    {
      $group: {
        _id: "$primaryArtistId",
        hours: { $sum: { $divide: ["$durationMs", HOUR_MS] } },
      },
    },
    { $sort: { hours: -1, _id: 1 } },
    { $limit: 100 },
  ]).option({ maxTimeMS: 15_000, allowDiskUse: true });
  if (!totals.length) return { ...base, artists: [] };
  const ids = totals.map((row) => row._id);
  const [daily, metadata] = await Promise.all([
    StatisticsInfosModel.aggregate<{
      _id: { artist: string; date: string };
      hours: number;
    }>([
      { $match: { ...match, primaryArtistId: { $in: ids } } },
      {
        $group: {
          _id: {
            artist: "$primaryArtistId",
            date: {
              $dateToString: {
                date: "$played_at",
                format: "%Y-%m-%d",
                timezone,
              },
            },
          },
          hours: { $sum: { $divide: ["$durationMs", HOUR_MS] } },
        },
      },
    ]).option({ maxTimeMS: 15_000, allowDiskUse: true }),
    getStatisticsArtists(ids),
  ]);
  const byId = new Map(metadata.map((artist) => [artist.id, artist]));
  const byArtist = new Map<string, { date: string; hours: number }[]>();
  for (const row of daily) {
    const days = byArtist.get(row._id.artist) ?? [];
    days.push({ date: row._id.date, hours: row.hours });
    byArtist.set(row._id.artist, days);
  }
  return {
    ...base,
    artists: totals.map((row) => ({
      id: row._id,
      name: byId.get(row._id)?.name ?? "Unknown artist",
      image: byId.get(row._id)?.images.at(-1)?.url,
      hours: row.hours,
      ...summarizeArtistDays(byArtist.get(row._id) ?? []),
    })),
  };
}
