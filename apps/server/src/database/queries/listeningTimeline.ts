import { PipelineStage } from "mongoose";

import { getWithDefault } from "../../tools/env";
import { statisticsFor } from "../listeningDuration";
import { AlbumModel, TrackModel } from "../Models";
import { User } from "../schemas/user";
import { StatisticsInfosModel } from "../StatisticsInfos";
import {
  bucketExpression,
  cumulativeHours,
  denseHours,
  HOUR_MS,
  timelineBounds,
} from "./listeningTimelineTools";

type Bucket = { _id: number; duration: number };
type RankedSeries = { _id: string; duration: number; buckets: Bucket[] };

function rankedSeries(field: string): PipelineStage.FacetPipelineStage[] {
  return [
    {
      $group: {
        _id: { item: `$${field}`, bucket: "$bucket" },
        duration: { $sum: "$durationMs" },
      },
    },
    {
      $group: {
        _id: "$_id.item",
        duration: { $sum: "$duration" },
        buckets: { $push: { _id: "$_id.bucket", duration: "$duration" } },
      },
    },
    { $sort: { duration: -1, _id: 1 } },
    { $limit: 5 },
  ];
}

export async function getArtistTimeline(user: User, artistId: string) {
  const Statistics = statisticsFor(user, { includeHiddenArtists: true });
  // Like existing artist detail statistics, include this artist even when it is
  // excluded from the user's global statistics by the blacklist.
  const match = {
    owner: user._id,
    primaryArtistId: artistId,
    durationMs: { $gt: 0, $lte: Number.MAX_SAFE_INTEGER },
  };
  const end = new Date();
  const first = await StatisticsInfosModel.findOne({
    ...match,
    played_at: { $lte: end },
  })
    .setOptions({ includeHiddenArtists: true })
    .sort({ played_at: 1 })
    .select("played_at")
    .lean();
  if (!first) return null;
  const bounds = timelineBounds(first.played_at, end, 200);
  const [result] = await Statistics.aggregate<{
    total: Bucket[];
    albums: RankedSeries[];
    songs: RankedSeries[];
    milestones: { _id: number; date: Date }[];
  }>([
    { $match: { ...match, played_at: { $lte: end } } },
    {
      $set: {
        timestamp: { $toLong: "$played_at" },
        bucket: bucketExpression(bounds),
      },
    },
    {
      $setWindowFields: {
        sortBy: { timestamp: 1 },
        output: {
          cumulative: {
            $sum: "$durationMs",
            window: { documents: ["unbounded", "current"] },
          },
        },
      },
    },
    {
      $facet: {
        total: [
          { $group: { _id: "$bucket", duration: { $sum: "$durationMs" } } },
        ],
        albums: rankedSeries("albumId"),
        songs: rankedSeries("id"),
        milestones: [
          { $set: { milestone: [10, 50, 100, 250, 500, 1000] } },
          { $unwind: "$milestone" },
          {
            $match: {
              $expr: {
                $gte: ["$cumulative", { $multiply: ["$milestone", HOUR_MS] }],
              },
            },
          },
          { $group: { _id: "$milestone", date: { $min: "$played_at" } } },
          { $sort: { _id: 1 } },
        ],
      },
    },
  ]).allowDiskUse(true);
  if (!result) return null;
  const [albums, songs] = await Promise.all([
    AlbumModel.find({ id: { $in: result.albums.map((item) => item._id) } })
      .select("id name images")
      .lean(),
    TrackModel.find({ id: { $in: result.songs.map((item) => item._id) } })
      .select("id name album")
      .lean(),
  ]);
  const songAlbums = await AlbumModel.find({
    id: { $in: songs.map((song) => song.album) },
  })
    .select("id images")
    .lean();
  return {
    ...bounds,
    timezone:
      user.settings.timezone ?? getWithDefault("TIMEZONE", "Europe/Paris"),
    total: cumulativeHours(denseHours(bounds, result.total)),
    albums: result.albums.map((item) => {
      const album = albums.find((value) => value.id === item._id);
      return {
        id: item._id,
        name: album?.name ?? "Unknown album",
        images: album?.images ?? [],
        hours: cumulativeHours(denseHours(bounds, item.buckets)),
      };
    }),
    songs: result.songs.map((item) => {
      const song = songs.find((value) => value.id === item._id);
      return {
        id: item._id,
        name: song?.name ?? "Unknown song",
        images:
          songAlbums.find((album) => album.id === song?.album)?.images ?? [],
        hours: cumulativeHours(denseHours(bounds, item.buckets)),
      };
    }),
    milestones: result.milestones.map((item) => ({
      hours: item._id,
      date: item.date,
    })),
  };
}
