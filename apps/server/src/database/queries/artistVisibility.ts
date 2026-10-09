import { Types } from "mongoose";

import { YourSpotifyError } from "../../tools/errors/error";
import { escapeRegExp } from "../../tools/utils";
import { ArtistModel, UserModel } from "../Models";

class VisibilityError extends YourSpotifyError {
  type = "MALFORMED" as const;

  toJSON() {
    return { message: this.message };
  }
}

export async function getArtistVisibility(owner: Types.ObjectId) {
  const user = await UserModel.findById(owner)
    .select("settings.artistVisibility")
    .lean();
  const entries = user?.settings.artistVisibility ?? [];
  const artists = await ArtistModel.find({
    id: { $in: entries.map((entry) => entry.artistId) },
  })
    .select("id name images")
    .lean();
  return entries.map((entry) => {
    const artist = artists.find((item) => item.id === entry.artistId);
    return {
      artistId: entry.artistId,
      hidden: entry.hidden,
      name: artist?.name ?? entry.artistId,
      images: artist?.images ?? [],
    };
  });
}

export function searchVisibilityArtists(query: string) {
  const pattern = escapeRegExp(query);
  return ArtistModel.find({ name: { $regex: pattern, $options: "i" } })
    .select("id name images")
    .sort({ name: 1, id: 1 })
    .limit(20)
    .lean();
}

/** Only preferences are written. Never calls the blacklist or modifies plays. */
export async function setArtistVisibility(
  owner: Types.ObjectId,
  artistId: string,
  hidden: boolean,
) {
  if (
    !(await ArtistModel.exists({ id: artistId })) &&
    !(await UserModel.exists({
      _id: owner,
      "settings.artistVisibility.artistId": artistId,
    }))
  )
    throw new VisibilityError("Choose an artist from your library.");
  const entries = { $ifNull: ["$settings.artistVisibility", []] };
  const result = await UserModel.updateOne(
    {
      _id: owner,
      $or: [
        { "settings.artistVisibility.artistId": artistId },
        { $expr: { $lt: [{ $size: entries }, 200] } },
      ],
    },
    [
      {
        $set: {
          "settings.artistVisibility": {
            $concatArrays: [
              {
                $filter: {
                  input: entries,
                  as: "entry",
                  cond: { $ne: ["$$entry.artistId", { $literal: artistId }] },
                },
              },
              { $literal: [{ artistId, hidden }] },
            ],
          },
        },
      },
    ],
    { updatePipeline: true },
  );
  if (!result.matchedCount)
    throw new VisibilityError("You can save up to 200 artists in this list.");
}

export async function removeArtistVisibility(
  owner: Types.ObjectId,
  artistId: string,
) {
  await UserModel.updateOne(
    { _id: owner },
    { $pull: { "settings.artistVisibility": { artistId } } },
  );
}
