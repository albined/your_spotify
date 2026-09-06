import { PipelineStage } from "mongoose";

import { getWithDefault } from "../../tools/env";
import { AlbumModel, ArtistModel, InfosModel, TrackModel } from "../Models";
import { User } from "../schemas/user";
import {
  bucketExpression,
  cumulativeHours,
  DAY_MS,
  denseHours,
  HOUR_MS,
  timelineBounds,
} from "./listeningTimelineTools";

type Bucket = { _id: number; duration: number };
type RankedSeries = { _id: string; duration: number; buckets: Bucket[] };

export async function getListeningDistribution(
  user: User,
  start: Date,
  end: Date,
) {
  const bounds = timelineBounds(start, end, 200);
  const match = {
    owner: user._id,
    blacklistedBy: { $exists: false },
    primaryArtistId: { $type: "string" },
  };
  // Find discovery dates before filtering the selected period. An old favourite
  // must not become "new" simply because the user changes the date selector.
  const rows = await InfosModel.aggregate<{
    _id: { bucket: number; artist: string };
    duration: number;
    newDuration: number;
  }>([
    { $match: { ...match, played_at: { $lt: end } } },
    {
      $setWindowFields: {
        partitionBy: "$primaryArtistId",
        sortBy: { played_at: 1 },
        output: {
          firstListen: {
            $min: "$played_at",
            window: { documents: ["unbounded", "current"] },
          },
        },
      },
    },
    { $match: { played_at: { $gte: start } } },
    {
      $group: {
        _id: { bucket: bucketExpression(bounds), artist: "$primaryArtistId" },
        duration: { $sum: "$durationMs" },
        newDuration: {
          $sum: {
            $cond: [
              {
                $lt: [
                  { $subtract: ["$played_at", "$firstListen"] },
                  30 * DAY_MS,
                ],
              },
              "$durationMs",
              0,
            ],
          },
        },
      },
    },
  ]).allowDiskUse(true);
  const totals = new Map<string, number>();
  for (const row of rows) {
    totals.set(
      row._id.artist,
      (totals.get(row._id.artist) ?? 0) + row.duration,
    );
  }
  const artistIds = [...totals]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 10)
    .map(([id]) => id);
  const artists = await ArtistModel.find({ id: { $in: artistIds } })
    .select("id name images")
    .lean();
  const artistById = new Map(artists.map((artist) => [artist.id, artist]));
  const series = artistIds.map((id) => ({
    id,
    name: artistById.get(id)?.name ?? "Unknown artist",
    images: artistById.get(id)?.images ?? [],
    hours: Array<number>(bounds.count).fill(0),
  }));
  const other = {
    id: "other",
    name: "Other artists",
    images: [],
    hours: Array<number>(bounds.count).fill(0),
    lineOnly: true,
  };
  const seriesById = new Map(series.map((item) => [item.id, item]));
  const newHours = Array<number>(bounds.count).fill(0);
  const totalHours = Array<number>(bounds.count).fill(0);
  const bucketArtists = Array.from(
    { length: bounds.count },
    () => [] as number[],
  );
  for (const row of rows) {
    const index = row._id.bucket;
    const target = seriesById.get(row._id.artist) ?? other;
    target.hours[index]! += row.duration / HOUR_MS;
    totalHours[index]! += row.duration / HOUR_MS;
    newHours[index]! += row.newDuration / HOUR_MS;
    bucketArtists[index]!.push(row.duration / HOUR_MS);
  }
  if (totals.size > artistIds.length) series.push(other);
  return {
    ...bounds,
    timezone:
      user.settings.timezone ?? getWithDefault("TIMEZONE", "Europe/Paris"),
    series,
    totalHours,
    newHours,
    familiarHours: totalHours.map((value, index) =>
      Math.max(0, value - newHours[index]!),
    ),
    topFiveShare: bucketArtists.map((values, index) =>
      totalHours[index]
        ? values
            .sort((a, b) => b - a)
            .slice(0, 5)
            .reduce((a, b) => a + b, 0) / totalHours[index]!
        : null,
    ),
  };
}

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
  // Like existing artist detail statistics, include this artist even when it is
  // excluded from the user's global statistics by the blacklist.
  const match = { owner: user._id, primaryArtistId: artistId };
  const end = new Date();
  const first = await InfosModel.findOne({ ...match, played_at: { $lte: end } })
    .sort({ played_at: 1 })
    .select("played_at")
    .lean();
  if (!first) return null;
  const bounds = timelineBounds(first.played_at, end, 200);
  type Peak = { played_at: Date; hours: number };
  const [result] = await InfosModel.aggregate<{
    total: Bucket[];
    albums: RankedSeries[];
    songs: RankedSeries[];
    peak7: Peak[];
    peak30: Peak[];
    milestones: { _id: number; date: Date }[];
    rediscoveries: { played_at: Date; previous: Date; gapDays: number }[];
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
          week: { $sum: "$durationMs", window: { range: [1 - 7 * DAY_MS, 0] } },
          month: {
            $sum: "$durationMs",
            window: { range: [1 - 30 * DAY_MS, 0] },
          },
          previous: { $shift: { output: "$played_at", by: -1 } },
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
        peak7: [
          { $sort: { week: -1, played_at: 1 } },
          { $limit: 1 },
          {
            $project: { played_at: 1, hours: { $divide: ["$week", HOUR_MS] } },
          },
        ],
        peak30: [
          { $sort: { month: -1, played_at: 1 } },
          { $limit: 1 },
          {
            $project: { played_at: 1, hours: { $divide: ["$month", HOUR_MS] } },
          },
        ],
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
        rediscoveries: [
          {
            $match: {
              previous: { $ne: null },
              $expr: {
                $gte: [{ $subtract: ["$played_at", "$previous"] }, 90 * DAY_MS],
              },
            },
          },
          { $sort: { played_at: -1 } },
          { $limit: 5 },
          {
            $project: {
              played_at: 1,
              previous: 1,
              gapDays: {
                $floor: {
                  $divide: [{ $subtract: ["$played_at", "$previous"] }, DAY_MS],
                },
              },
            },
          },
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
    peaks: [7, 30].map((days) => {
      const peak = (days === 7 ? result.peak7 : result.peak30)[0];
      return {
        days,
        hours: peak?.hours ?? 0,
        end: peak?.played_at ?? end,
        start: new Date((peak?.played_at ?? end).getTime() - days * DAY_MS),
      };
    }),
    milestones: result.milestones.map((item) => ({
      hours: item._id,
      date: item.date,
    })),
    rediscoveries: result.rediscoveries.map((item) => ({
      date: item.played_at,
      previous: item.previous,
      gapDays: item.gapDays,
    })),
  };
}
