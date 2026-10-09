import { PipelineStage, Types } from "mongoose";

import { getWithDefault } from "../../tools/env";
import { statisticsFor } from "../listeningDuration";
import { User } from "../schemas/user";
import { requireCompetitionParticipants } from "./competitionParticipants";
import { getItemDetails, itemField, ItemKind } from "./listeningItems";
import {
  bucketExpression,
  cumulativeHours,
  denseHours,
  timelineBounds,
  TimelineBounds,
} from "./listeningTimelineTools";
import { RaceLeaders } from "./raceLeaders";

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

export async function getTopTimeline(
  user: User,
  start: Date,
  end: Date,
  kind: ItemKind,
) {
  const Statistics = statisticsFor(user);
  const bounds = timelineBounds(start, end, 200);
  const field = itemField[kind];
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
  const plays = Statistics.aggregate<{
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
    ? await Statistics.aggregate<{
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
  const details = await getItemDetails(kind, ids);
  return {
    ...bounds,
    timezone:
      user.settings.timezone ?? getWithDefault("TIMEZONE", "Europe/Paris"),
    series: top.map((item) => {
      const { name, subtitle, images } = details(item._id);
      return {
        id: item._id,
        name,
        subtitle,
        images,
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
  // Narrows the race to one song, album or artist.
  item?: { kind: ItemKind; id: string },
) {
  const Statistics = statisticsFor(user);
  const bounds = timelineBounds(start, end, 200);
  const accounts = await requireCompetitionParticipants(userIds);
  const ids = accounts.map((account) => account._id.toHexString());
  const match = {
    owner: { $in: ids.map((id) => new Types.ObjectId(id)) },
    blacklistedBy: { $exists: false },
    played_at: { $gte: start, $lt: end },
    ...(item ? { [itemField[item.kind]]: item.id } : {}),
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
  const rows = await Statistics.aggregate<{
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
