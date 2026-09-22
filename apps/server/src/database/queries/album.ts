import { AlbumModel } from "../Models";
import { User } from "../schemas/user";
import { StatisticsInfosModel } from "../StatisticsInfos";
import {
  normalizeArtistCredits,
  populateStatisticsArtists,
} from "./artistGroups";

export const getAlbums = async (albumsId: string[]) =>
  normalizeArtistCredits(
    await AlbumModel.find({ id: { $in: albumsId } }).lean(),
  );

export const searchAlbum = async (str: string) => {
  return populateStatisticsArtists(
    await AlbumModel.find({ name: { $regex: new RegExp(str, "i") } }).lean(),
  );
};

export const getAlbumInfos = (albumId: string) => [
  {
    $lookup: {
      from: "tracks",
      let: { targetId: "$id" },
      pipeline: [
        {
          $match: {
            $expr: {
              $and: [
                { $eq: ["$album", albumId] },
                { $eq: ["$id", "$$targetId"] },
              ],
            },
          },
        },
        { $project: { trackId: "$id", albumId: "$album" } },
      ],
      as: "albumInfos",
    },
  },
  { $match: { "albumInfos.albumId": { $exists: true } } },
  { $unwind: "$albumInfos" },
];

export const getFirstAndLastListenedAlbum = async (
  user: User,
  albumId: string,
) => {
  const res = await StatisticsInfosModel.aggregate([
    { $match: { owner: user._id, albumId: albumId } },
    ...getAlbumInfos(albumId),
    { $sort: { played_at: 1 } },
    {
      $group: {
        _id: null,
        first: { $first: "$$ROOT" },
        last: { $last: "$$ROOT" },
      },
    },
    ...["first", "last"]
      .map((e) => [
        {
          $lookup: {
            from: "tracks",
            localField: `${e}.albumInfos.trackId`,
            foreignField: "id",
            as: `${e}.track`,
          },
        },
        { $unwind: `$${e}.track` },
      ])
      .flat(1),
  ]);
  return res[0];
};

export const getAlbumSongs = async (user: User, albumId: string) => {
  const res = await StatisticsInfosModel.aggregate([
    { $match: { owner: user._id, albumId: albumId } },
    ...getAlbumInfos(albumId),
    { $group: { _id: "$id", count: { $sum: 1 } } },
    { $sort: { count: -1 } },
    {
      $lookup: {
        from: "tracks",
        localField: "_id",
        foreignField: "id",
        as: "track",
      },
    },
    { $unwind: "$track" },
  ]);
  return res;
};
