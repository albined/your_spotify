import { PipelineStage, Types } from "mongoose";

import { getWithDefault } from "../../tools/env";
import { AlbumModel, ArtistModel, InfosModel, TrackModel } from "../Models";
import { User } from "../schemas/user";
import { requireCompetitionParticipants } from "./competitionParticipants";
import {
  bucketExpression,
  cumulativeHours,
  denseHours,
  timelineBounds,
  TimelineBounds,
} from "./listeningTimelineTools";
import { RaceLeaders } from "./raceLeaders";

export type TopTimelineKind = "songs" | "albums" | "artists";
export type CompetitionMetric =
  | "hours"
  | "count"
  | "differentTracks"
  | "differentArtists";

const validDuration = {
  $type: "number",
  $gt: 0,
  $lte: Number.MAX_SAFE_INTEGER,
};

export async function getCompetitionArtists(
  userIds: string[],
  start: Date,
  end: Date,
) {
  const accounts = await requireCompetitionParticipants(userIds);
  const ids = accounts.map((account) => account._id.toHexString());
  if (!ids.length) return [];
  const ranked = await InfosModel.aggregate<{
    _id: string;
    minimumDuration: number;
    totalDuration: number;
  }>([
    {
      $match: {
        owner: { $in: ids.map((id) => new Types.ObjectId(id)) },
        played_at: { $gte: start, $lt: end },
        blacklistedBy: { $exists: false },
        primaryArtistId: { $type: "string", $ne: "" },
        durationMs: validDuration,
      },
    },
    {
      $group: {
        _id: { artist: "$primaryArtistId", owner: "$owner" },
        duration: { $sum: "$durationMs" },
      },
    },
    {
      $group: {
        _id: "$_id.artist",
        minimumDuration: { $min: "$duration" },
        totalDuration: { $sum: "$duration" },
        listeners: { $sum: 1 },
      },
    },
    // Missing participants have zero hours; taking only the minimum of
    // existing rows would incorrectly promote one person's favorite artist.
    {
      $set: {
        minimumDuration: {
          $cond: [{ $eq: ["$listeners", ids.length] }, "$minimumDuration", 0],
        },
      },
    },
    { $sort: { minimumDuration: -1, totalDuration: -1, _id: 1 } },
    { $limit: 200 },
  ]).option({ maxTimeMS: 15_000, allowDiskUse: true });
  const metadata = await ArtistModel.find({
    id: { $in: ranked.map((row) => row._id) },
  })
    .select("id name images")
    .maxTimeMS(15_000)
    .lean();
  const byId = new Map(metadata.map((artist) => [artist.id, artist]));
  return ranked.map((row) => ({
    id: row._id,
    name: byId.get(row._id)?.name ?? "Unknown artist",
    image: byId.get(row._id)?.images.at(-1)?.url,
    minimumHours: row.minimumDuration / 3_600_000,
    totalHours: row.totalDuration / 3_600_000,
  }));
}

export async function getTopTimeline(
  user: User,
  start: Date,
  end: Date,
  kind: TopTimelineKind,
) {
  const bounds = timelineBounds(start, end, 200);
  const field = (
    { songs: "id", albums: "albumId", artists: "primaryArtistId" } as const
  )[kind];
  const crownEnd = Math.min(end.getTime(), Date.now());
  const match = {
    owner: user._id,
    blacklistedBy: { $exists: false },
    played_at: { $gte: start, $lt: new Date(crownEnd) },
    durationMs: validDuration,
  };
  // Inspect every contender at actual play timestamps, independently of the
  // chart's display resolution. Stream plays to keep memory bounded by entries.
  const race = new RaceLeaders();
  const plays = InfosModel.aggregate<{
    item: string;
    played_at: Date;
    durationMs: number;
  }>([
    { $match: { ...match, [field]: { $type: "string", $ne: "" } } },
    { $sort: { played_at: 1 } },
    { $project: { _id: 0, item: `$${field}`, played_at: 1, durationMs: 1 } },
  ])
    .option({ maxTimeMS: 15_000, allowDiskUse: true })
    .cursor({ batchSize: 1000 });
  try {
    for await (const play of plays) {
      race.add(play.item, play.played_at.getTime(), play.durationMs);
    }
  } finally {
    await plays.close();
  }
  const top = race.select(crownEnd);
  const ids = top.map((item) => item._id);
  const buckets = ids.length
    ? await InfosModel.aggregate<{
        _id: { item: string; bucket: number };
        duration: number;
      }>([
        { $match: { ...match, [field]: { $in: ids } } },
        {
          $group: {
            _id: { item: `$${field}`, bucket: bucketExpression(bounds) },
            duration: { $sum: "$durationMs" },
          },
        },
      ])
    : [];
  const [tracks, albums, artists] = await Promise.all([
    kind === "songs"
      ? TrackModel.find({ id: { $in: ids } })
          .select("id name album artists")
          .lean()
      : [],
    kind === "albums"
      ? AlbumModel.find({ id: { $in: ids } })
          .select("id name images artists")
          .lean()
      : [],
    kind === "artists"
      ? ArtistModel.find({ id: { $in: ids } })
          .select("id name images")
          .lean()
      : [],
  ]);
  const [covers, credits] = await Promise.all([
    tracks.length
      ? AlbumModel.find({ id: { $in: tracks.map((track) => track.album) } })
          .select("id images")
          .lean()
      : [],
    kind !== "artists"
      ? ArtistModel.find({
          id: { $in: [...tracks, ...albums].flatMap((item) => item.artists) },
        })
          .select("id name")
          .lean()
      : [],
  ]);
  return {
    ...bounds,
    timezone:
      user.settings.timezone ?? getWithDefault("TIMEZONE", "Europe/Paris"),
    series: top.map((item) => {
      const track = tracks.find((value) => value.id === item._id);
      const album = albums.find((value) => value.id === item._id);
      const artist = artists.find((value) => value.id === item._id);
      return {
        id: item._id,
        name:
          (track ?? album ?? artist)?.name ?? `Unknown ${kind.slice(0, -1)}`,
        subtitle: (track ?? album)?.artists
          .map((id) => credits.find((value) => value.id === id)?.name)
          .filter(Boolean)
          .join(", "),
        images:
          album?.images ??
          artist?.images ??
          covers.find((value) => value.id === track?.album)?.images ??
          [],
        hours: cumulativeHours(
          denseHours(
            bounds,
            buckets
              .filter((bucket) => bucket._id.item === item._id)
              .map((bucket) => ({
                _id: bucket._id.bucket,
                duration: bucket.duration,
              })),
          ),
        ),
      };
    }),
  };
}

function cumulativeValues(
  bounds: TimelineBounds,
  buckets: { bucket: number; value: number }[],
) {
  const values = Array<number>(bounds.count).fill(0);
  for (const bucket of buckets) values[bucket.bucket]! += bucket.value;
  let total = 0;
  return [0, ...values.map((value) => (total += value))];
}

export async function getCompetitionTimeline(
  user: User,
  userIds: string[],
  start: Date,
  end: Date,
  metric: CompetitionMetric,
  artistId?: string,
) {
  const bounds = timelineBounds(start, end, 200);
  const accounts = await requireCompetitionParticipants(userIds);
  const ids = accounts.map((account) => account._id.toHexString());
  const match = {
    owner: { $in: ids.map((id) => new Types.ObjectId(id)) },
    blacklistedBy: { $exists: false },
    played_at: { $gte: start, $lt: end },
    ...(artistId ? { primaryArtistId: artistId } : {}),
    ...(metric === "hours" ? { durationMs: validDuration } : {}),
  };
  const unique = metric === "differentTracks" || metric === "differentArtists";
  // Count a unique item at its first bucket in the selected range. Summing each
  // bucket's distinct count would count returning songs/artists repeatedly.
  const pipeline: PipelineStage[] = unique
    ? [
        {
          $group: {
            _id: {
              owner: "$owner",
              item: metric === "differentTracks" ? "$id" : "$primaryArtistId",
            },
            bucket: { $min: "$bucket" },
          },
        },
        {
          $group: {
            _id: { owner: "$_id.owner", bucket: "$bucket" },
            value: { $sum: 1 },
          },
        },
      ]
    : [
        {
          $group: {
            _id: { owner: "$owner", bucket: "$bucket" },
            value: {
              $sum:
                metric === "hours"
                  ? { $divide: ["$durationMs", 3_600_000] }
                  : 1,
            },
          },
        },
      ];
  const rows = await InfosModel.aggregate<{
    _id: { owner: Types.ObjectId; bucket: number };
    value: number;
  }>([
    { $match: match },
    ...(unique
      ? [
          {
            $match: {
              [metric === "differentTracks" ? "id" : "primaryArtistId"]: {
                $type: "string",
              },
            },
          },
        ]
      : []),
    { $set: { bucket: bucketExpression(bounds) } },
    ...pipeline,
  ]).allowDiskUse(true);
  return {
    ...bounds,
    timezone:
      user.settings.timezone ?? getWithDefault("TIMEZONE", "Europe/Paris"),
    series: ids
      .filter((id) => accounts.some((account) => account._id.toString() === id))
      .map((id) => ({
        id,
        name: accounts.find((account) => account._id.toString() === id)!
          .username,
        values: cumulativeValues(
          bounds,
          rows
            .filter((row) => row._id.owner.toString() === id)
            .map((row) => ({ bucket: row._id.bucket, value: row.value })),
        ),
      })),
  };
}
