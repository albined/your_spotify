import { getWithDefault } from "../../tools/env";
import { AlbumModel, InfosModel } from "../Models";
import { User } from "../schemas/user";
import { bucketExpression, HOUR_MS } from "./listeningTimelineTools";

// Spotify can provide year, month, or day precision. Never turn missing or
// malformed metadata into year zero, or invent finer release-date precision.
export function releaseYear(value: unknown): number | null {
  if (typeof value !== "string" || !/^\d{4}(-\d{2})?(-\d{2})?$/.test(value)) {
    return null;
  }
  const [year, month = 1, day = 1] = value.split("-").map(Number);
  if (!year || month < 1 || month > 12 || day < 1) return null;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= days[month - 1]! ? year : null;
}

export async function getReleaseDistribution(
  user: User,
  start: Date,
  end: Date,
) {
  const bounds = {
    start: start.getTime(),
    end: end.getTime(),
    count: 256,
    width: (end.getTime() - start.getTime()) / 256,
  };
  const rows = await InfosModel.aggregate<{
    _id: { album: string; bucket: number };
    plays: number;
    hours: number;
  }>([
    {
      $match: {
        owner: user._id,
        played_at: { $gte: start, $lt: end },
        blacklistedBy: { $exists: false },
      },
    },
    {
      $group: {
        _id: { album: "$albumId", bucket: bucketExpression(bounds) },
        plays: { $sum: 1 },
        hours: {
          $sum: {
            $cond: [
              {
                $and: [
                  { $isNumber: "$durationMs" },
                  { $gte: ["$durationMs", 0] },
                  { $lte: ["$durationMs", Number.MAX_SAFE_INTEGER] },
                ],
              },
              { $divide: ["$durationMs", HOUR_MS] },
              0,
            ],
          },
        },
      },
    },
  ]).option({ maxTimeMS: 15_000, allowDiskUse: true });
  const albums = await AlbumModel.find({
    id: {
      $in: [
        ...new Set(
          rows
            .map((row) => row._id.album)
            .filter((id): id is string => typeof id === "string"),
        ),
      ],
    },
  })
    .select("id release_date")
    .maxTimeMS(15_000)
    .lean();
  const yearsByAlbum = new Map(
    albums.map((album) => [album.id, releaseYear(album.release_date)]),
  );
  const years = new Map<
    number,
    { year: number; hours: number; plays: number }
  >();
  const decades = new Map<
    number,
    { decade: number; plays: number; hours: number[] }
  >();
  let totalPlays = 0;
  let unknownPlays = 0;
  for (const row of rows) {
    totalPlays += row.plays;
    const year = row._id.album ? yearsByAlbum.get(row._id.album) : null;
    if (year == null) {
      unknownPlays += row.plays;
      continue;
    }
    const item = years.get(year) ?? { year, hours: 0, plays: 0 };
    item.hours += row.hours;
    item.plays += row.plays;
    years.set(year, item);
    const decade = Math.floor(year / 10) * 10;
    const band = decades.get(decade) ?? {
      decade,
      plays: 0,
      hours: Array(bounds.count).fill(0),
    };
    band.plays += row.plays;
    band.hours[row._id.bucket]! += row.hours;
    decades.set(decade, band);
  }
  return {
    ...bounds,
    timezone:
      user.settings.timezone ?? getWithDefault("TIMEZONE", "Europe/Paris"),
    totalPlays,
    unknownPlays,
    years: [...years.values()].sort((a, b) => a.year - b.year),
    decades: [...decades.values()]
      .filter((row) => row.plays * 100 >= totalPlays)
      .sort((a, b) => a.decade - b.decade),
  };
}
