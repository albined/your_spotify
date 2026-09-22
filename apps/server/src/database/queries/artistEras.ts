import { statisticsTimezone } from "../../tools/allTimeStart";
import { ArtistModel, InfosModel } from "../Models";
import { User } from "../schemas/user";
import { ArtistPeriod, selectEraArtists } from "./artistErasSelection";
import {
  bucketExpression,
  DAY_MS,
  HOUR_MS,
  timelineBounds,
} from "./listeningTimelineTools";

export async function getArtistEras(user: User, start: Date, end: Date) {
  const bounds = timelineBounds(start, end, 256);
  const timezone = statisticsTimezone(user);
  const unit = bounds.end - bounds.start >= 180 * DAY_MS ? "month" : "week";
  const match = {
    owner: user._id,
    played_at: { $gte: start, $lt: end },
    blacklistedBy: { $exists: false },
    primaryArtistId: { $type: "string", $ne: "" },
    durationMs: { $type: "number", $gt: 0, $lte: Number.MAX_SAFE_INTEGER },
  };
  const periods = await InfosModel.aggregate<ArtistPeriod>([
    { $match: match },
    {
      $group: {
        _id: {
          artist: "$primaryArtistId",
          period: {
            $dateTrunc: {
              date: "$played_at",
              unit,
              timezone,
              ...(unit === "week" ? { startOfWeek: "monday" } : {}),
            },
          },
        },
        duration: { $sum: "$durationMs" },
      },
    },
    {
      $project: {
        _id: 0,
        artist: "$_id.artist",
        period: { $toLong: "$_id.period" },
        duration: 1,
      },
    },
  ]).option({ maxTimeMS: 15_000, allowDiskUse: true });
  const selections = selectEraArtists(periods);
  const ids = selections[20];
  const [buckets, metadata] = await Promise.all([
    ids.length
      ? InfosModel.aggregate<{
          _id: { artist: string; bucket: number };
          duration: number;
        }>([
          { $match: { ...match, primaryArtistId: { $in: ids } } },
          {
            $group: {
              _id: {
                artist: "$primaryArtistId",
                bucket: bucketExpression(bounds),
              },
              duration: { $sum: "$durationMs" },
            },
          },
        ]).option({ maxTimeMS: 15_000, allowDiskUse: true })
      : [],
    ArtistModel.find({ id: { $in: ids } })
      .select("id name images")
      .maxTimeMS(15_000)
      .lean(),
  ]);
  const byId = new Map(metadata.map((artist) => [artist.id, artist]));
  return {
    ...bounds,
    timezone,
    selections,
    series: ids.map((id) => ({
      id,
      name: byId.get(id)?.name ?? "Unknown artist",
      image: byId.get(id)?.images.at(-1)?.url,
      bins: buckets
        .filter((row) => row._id.artist === id)
        .map((row): [number, number] => [
          row._id.bucket,
          row.duration / HOUR_MS,
        ])
        .sort(([a], [b]) => a - b),
    })),
  };
}
