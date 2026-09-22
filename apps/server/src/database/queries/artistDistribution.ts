import { getWithDefault } from "../../tools/env";
import { ArtistModel, InfosModel } from "../Models";
import { User } from "../schemas/user";
import { bucketExpression, HOUR_MS } from "./listeningTimelineTools";

export const ARTIST_DISTRIBUTION_MAX_ARTISTS = 30;
export const ARTIST_DISTRIBUTION_MAX_BINS = 256;

// Sparse bins retain every artist without sending thousands of zeroes per row.
// The KDE smooths over several bins for year-scale ranges, so 256 bins keep the
// response small without changing the shape users see.
export async function getArtistDistribution(
  user: User,
  start: Date,
  end: Date,
) {
  const span = Math.max(1, end.getTime() - start.getTime());
  const count = Math.min(
    ARTIST_DISTRIBUTION_MAX_BINS,
    Math.max(1, Math.ceil(span / HOUR_MS)),
  );
  const bounds = {
    start: start.getTime(),
    end: end.getTime(),
    count,
    width: span / count,
  };
  const rows = await InfosModel.aggregate<{
    _id: string;
    total: number;
    bins: { bucket: number; duration: number }[];
  }>([
    {
      $match: {
        owner: user._id,
        played_at: { $gte: start, $lt: end },
        blacklistedBy: { $exists: false },
        durationMs: { $type: "number", $gt: 0, $lte: Number.MAX_SAFE_INTEGER },
      },
    },
    {
      $group: {
        _id: {
          artist: {
            $cond: [
              { $eq: [{ $type: "$primaryArtistId" }, "string"] },
              "$primaryArtistId",
              "",
            ],
          },
          bucket: bucketExpression(bounds),
        },
        duration: { $sum: "$durationMs" },
      },
    },
    {
      $group: {
        _id: "$_id.artist",
        total: { $sum: "$duration" },
        bins: { $push: { bucket: "$_id.bucket", duration: "$duration" } },
      },
    },
    { $sort: { total: -1, _id: 1 } },
    { $limit: ARTIST_DISTRIBUTION_MAX_ARTISTS },
  ]).option({ maxTimeMS: 15_000, allowDiskUse: true });
  const bins = new Map<string, [number, number][]>();
  for (const row of rows) {
    bins.set(
      row._id,
      row.bins
        .map(
          ({ bucket, duration }) =>
            [bucket, duration / HOUR_MS] as [number, number],
        )
        .sort(([a], [b]) => a - b),
    );
  }
  const artists = await ArtistModel.find({ id: { $in: [...bins.keys()] } })
    .select("id name images")
    .maxTimeMS(15_000)
    .lean();
  const metadata = new Map(artists.map((artist) => [artist.id, artist]));
  return {
    ...bounds,
    timezone:
      user.settings.timezone ?? getWithDefault("TIMEZONE", "Europe/Paris"),
    series: [...bins].map(([id, values]) => ({
      id,
      name: metadata.get(id)?.name ?? "Unknown artist",
      image: metadata.get(id)?.images.at(-1)?.url,
      bins: values.sort(([a], [b]) => a - b),
    })),
  };
}
