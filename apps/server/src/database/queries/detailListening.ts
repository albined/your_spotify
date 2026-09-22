import { PipelineStage } from "mongoose";

import {
  calendarDate,
  startOfCalendarDate,
  statisticsTimezone,
} from "../../tools/allTimeStart";
import { InfosModel, TrackModel } from "../Models";
import { User } from "../schemas/user";
import { getArtistItemEras } from "./artistItemEras";
import {
  bucketExpression,
  HOUR_MS,
  timelineBounds,
} from "./listeningTimelineTools";

export type ListeningItemKind = "song" | "album" | "artist";

export async function getDetailListening(
  user: User,
  kind: ListeningItemKind,
  id: string,
) {
  const end = new Date();
  const timezone = statisticsTimezone(user);
  const field = { song: "id", album: "albumId", artist: "primaryArtistId" }[
    kind
  ];
  const base = {
    owner: user._id,
    played_at: { $lt: end },
    durationMs: { $gt: 0, $lte: Number.MAX_SAFE_INTEGER },
  };
  // Detail statistics include explicitly viewed items even when blacklisted.
  // The All-range preference must not trim a detail page's lifetime history.
  const match = {
    ...base,
    [field]: id,
    durationMs: { ...base.durationMs, $type: "number" },
  };
  const first = await InfosModel.findOne({ ...base, [field]: id })
    .sort({ played_at: 1 })
    .select("played_at")
    .maxTimeMS(15_000)
    .lean();
  if (!first) return null;
  const start = startOfCalendarDate(
    calendarDate(first.played_at.getTime(), timezone),
    timezone,
  );
  const bounds = timelineBounds(start, end, 1024);
  const hoursGroup: PipelineStage.FacetPipelineStage[] = [
    {
      $group: {
        _id: { $hour: { date: "$played_at", timezone } },
        hours: { $sum: { $divide: ["$durationMs", HOUR_MS] } },
      },
    },
  ];
  const facets: Record<string, PipelineStage.FacetPipelineStage[]> = {
    days: [
      {
        $group: {
          _id: {
            $dateToString: { date: "$played_at", format: "%Y-%m-%d", timezone },
          },
          hours: { $sum: { $divide: ["$durationMs", HOUR_MS] } },
        },
      },
      { $sort: { _id: 1 } },
    ],
  };
  if (kind === "artist") {
    facets.activity = [
      {
        $group: {
          _id: bucketExpression(bounds),
          hours: { $sum: { $divide: ["$durationMs", HOUR_MS] } },
        },
      },
    ];
    facets.hours = hoursGroup;
  }
  if (kind === "album") {
    facets.tracks = [
      { $match: { id: { $type: "string", $ne: "" } } },
      {
        $group: {
          _id: { track: "$id", bucket: bucketExpression(bounds) },
          hours: { $sum: { $divide: ["$durationMs", HOUR_MS] } },
        },
      },
      {
        $group: {
          _id: "$_id.track",
          bins: { $push: { bucket: "$_id.bucket", hours: "$hours" } },
        },
      },
    ];
  }
  const [[result], overall, eras] = await Promise.all([
    InfosModel.aggregate<{
      days: { _id: string; hours: number }[];
      activity?: { _id: number; hours: number }[];
      hours?: { _id: number; hours: number }[];
      tracks?: { _id: string; bins: { bucket: number; hours: number }[] }[];
    }>([{ $match: match }, { $facet: facets }]).option({
      maxTimeMS: 15_000,
      allowDiskUse: true,
    }),
    kind === "artist"
      ? InfosModel.aggregate<{ _id: number; hours: number }>([
          {
            $match: {
              ...base,
              durationMs: match.durationMs,
              blacklistedBy: { $exists: false },
            },
          },
          ...hoursGroup,
        ]).option({ maxTimeMS: 15_000, allowDiskUse: true })
      : [],
    kind === "artist" ? getArtistItemEras(user, id, start, end) : null,
  ]);
  const trackRows = result?.tracks ?? [];
  const metadata =
    kind === "album"
      ? await TrackModel.find({
          $or: [
            { album: id },
            { id: { $in: trackRows.map((row) => row._id) } },
          ],
        })
          .select("id name disc_number track_number")
          .maxTimeMS(15_000)
          .lean()
      : [];
  const byId = new Map(metadata.map((track) => [track.id, track]));
  const tracks = [
    ...new Set([
      ...metadata.map((track) => track.id),
      ...trackRows.map((row) => row._id),
    ]),
  ]
    .sort((a, b) => {
      const left = byId.get(a);
      const right = byId.get(b);
      return (
        (left?.disc_number ?? Infinity) - (right?.disc_number ?? Infinity) ||
        (left?.track_number ?? Infinity) - (right?.track_number ?? Infinity) ||
        a.localeCompare(b)
      );
    })
    .map((trackId) => ({
      id: trackId,
      name: byId.get(trackId)?.name ?? "Unknown song",
      bins: (trackRows.find((row) => row._id === trackId)?.bins ?? [])
        .map((bin): [number, number] => [bin.bucket, bin.hours])
        .sort(([a], [b]) => a - b),
    }));
  const denseHours = (rows: { _id: number; hours: number }[]) =>
    Array.from(
      { length: 24 },
      (_, hour) => rows.find((row) => row._id === hour)?.hours ?? 0,
    );
  return {
    ...bounds,
    timezone,
    days: (result?.days ?? []).map((day) => ({
      date: day._id,
      hours: day.hours,
    })),
    activity: (result?.activity ?? [])
      .map((row): [number, number] => [row._id, row.hours])
      .sort(([a], [b]) => a - b),
    tracks,
    eras,
    timeOfDay:
      kind === "artist"
        ? {
            artist: denseHours(result?.hours ?? []),
            overall: denseHours(overall),
          }
        : null,
  };
}
