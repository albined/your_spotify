import { statisticsTimezone } from "../../tools/allTimeStart";
import { User } from "../schemas/user";
import { StatisticsInfosModel } from "../StatisticsInfos";
import { getStatisticsArtists } from "./artistGroups";
import { HOUR_MS } from "./listeningTimelineTools";

export async function getArtistHours(user: User, start: Date, end: Date) {
  const timezone = statisticsTimezone(user);
  const ranked = await StatisticsInfosModel.aggregate<{
    _id: string;
    duration: number;
    hours: { hour: number; duration: number }[];
  }>([
    {
      $match: {
        owner: user._id,
        played_at: { $gte: start, $lt: end },
        blacklistedBy: { $exists: false },
        primaryArtistId: { $type: "string", $ne: "" },
        durationMs: { $type: "number", $gt: 0, $lte: Number.MAX_SAFE_INTEGER },
      },
    },
    {
      $group: {
        _id: {
          artist: "$primaryArtistId",
          hour: { $hour: { date: "$played_at", timezone } },
        },
        duration: { $sum: "$durationMs" },
      },
    },
    {
      $group: {
        _id: "$_id.artist",
        duration: { $sum: "$duration" },
        hours: { $push: { hour: "$_id.hour", duration: "$duration" } },
      },
    },
    { $sort: { duration: -1, _id: 1 } },
    { $limit: 20 },
  ]).option({ maxTimeMS: 15_000, allowDiskUse: true });
  const artists = await getStatisticsArtists(ranked.map((row) => row._id));
  const byId = new Map(artists.map((artist) => [artist.id, artist]));
  return {
    timezone,
    series: ranked.map((row) => {
      const hours = Array<number>(24).fill(0);
      for (const bucket of row.hours)
        hours[bucket.hour] = bucket.duration / HOUR_MS;
      return {
        id: row._id,
        name: byId.get(row._id)?.name ?? "Unknown artist",
        hours,
      };
    }),
  };
}
