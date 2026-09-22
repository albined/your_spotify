import { statisticsTimezone } from "../../tools/allTimeStart";
import { AlbumModel, TrackModel } from "../Models";
import { User } from "../schemas/user";
import { StatisticsInfosModel } from "../StatisticsInfos";
import {
  selectEraAlbums,
  selectEraSongs,
  SongPeriod,
} from "./artistItemErasSelection";
import {
  bucketExpression,
  DAY_MS,
  HOUR_MS,
  timelineBounds,
} from "./listeningTimelineTools";

export async function getArtistItemEras(
  user: User,
  artistId: string,
  start: Date,
  end: Date,
) {
  const bounds = timelineBounds(start, end, 256);
  const timezone = statisticsTimezone(user);
  const unit = bounds.end - bounds.start >= 180 * DAY_MS ? "month" : "week";
  // Match detail-page attribution and retain explicitly viewed blacklisted plays.
  const match = {
    owner: user._id,
    primaryArtistId: artistId,
    played_at: { $gte: start, $lt: end },
    durationMs: { $type: "number", $gt: 0, $lte: Number.MAX_SAFE_INTEGER },
  };
  const [selection] = await StatisticsInfosModel.aggregate<{
    songs: SongPeriod[];
    albums: { id: string; duration: number }[];
    total: { duration: number }[];
  }>([
    { $match: match },
    {
      $facet: {
        songs: [
          { $match: { id: { $type: "string", $ne: "" } } },
          {
            $group: {
              _id: {
                id: "$id",
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
              plays: { $sum: 1 },
            },
          },
          {
            $project: {
              _id: 0,
              id: "$_id.id",
              period: { $toLong: "$_id.period" },
              duration: 1,
              plays: 1,
            },
          },
        ],
        albums: [
          { $match: { albumId: { $type: "string", $ne: "" } } },
          { $group: { _id: "$albumId", duration: { $sum: "$durationMs" } } },
          { $project: { _id: 0, id: "$_id", duration: 1 } },
        ],
        total: [{ $group: { _id: null, duration: { $sum: "$durationMs" } } }],
      },
    },
  ]).option({ maxTimeMS: 15_000, allowDiskUse: true });
  const albumIds = selectEraAlbums(
    selection?.albums ?? [],
    selection?.total[0]?.duration ?? 0,
  );
  const songIds = selectEraSongs(selection?.songs ?? []);
  const bins = (field: string, ids: string[]) => [
    { $match: { [field]: { $in: ids } } },
    {
      $group: {
        _id: { id: `$${field}`, bucket: bucketExpression(bounds) },
        hours: { $sum: { $divide: ["$durationMs", HOUR_MS] } },
      },
    },
  ];
  type Bin = { _id: { id: string; bucket: number }; hours: number };
  const [[result], albums, songs] = await Promise.all([
    StatisticsInfosModel.aggregate<{ albums: Bin[]; songs: Bin[] }>([
      {
        $match: {
          ...match,
          $or: [{ albumId: { $in: albumIds } }, { id: { $in: songIds } }],
        },
      },
      {
        $facet: {
          albums: bins("albumId", albumIds),
          songs: bins("id", songIds),
        },
      },
    ]).option({ maxTimeMS: 15_000, allowDiskUse: true }),
    AlbumModel.find({ id: { $in: albumIds } })
      .select("id name")
      .maxTimeMS(15_000)
      .lean(),
    TrackModel.find({ id: { $in: songIds } })
      .select("id name")
      .maxTimeMS(15_000)
      .lean(),
  ]);
  const series = (
    ids: string[],
    metadata: { id: string; name: string }[],
    rows: Bin[],
    fallback: string,
  ) =>
    ids.map((id) => ({
      id,
      name: metadata.find((item) => item.id === id)?.name ?? fallback,
      bins: rows
        .filter((row) => row._id.id === id)
        .map((row): [number, number] => [row._id.bucket, row.hours])
        .sort(([a], [b]) => a - b),
    }));
  return {
    ...bounds,
    timezone,
    albums: series(albumIds, albums, result?.albums ?? [], "Unknown album"),
    songs: series(songIds, songs, result?.songs ?? [], "Unknown song"),
  };
}
