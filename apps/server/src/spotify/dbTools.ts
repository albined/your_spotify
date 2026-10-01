import mongoose from "mongoose";

import {
  addTrackIdsToUser,
  storeInUser,
  storeFirstListenedAtIfLess,
} from "../database";
import { TrackModel, AlbumModel, ArtistModel } from "../database/Models";
import { Album } from "../database/schemas/album";
import { Artist } from "../database/schemas/artist";
import { Infos } from "../database/schemas/info";
import { SpotifyTrack, Track } from "../database/schemas/track";
import { SpotifyAPI } from "../tools/apis/spotifyApi";
import { logger } from "../tools/logger";
import { Metrics } from "../tools/metrics";
import { minOfArray, uniqBy } from "../tools/misc";
import { compact } from "../tools/utils";

export const getTracks = async (userId: string, ids: string[]) => {
  const client = new SpotifyAPI(userId);
  const spotifyTracks = compact(await client.getTracks(ids));

  const tracks = spotifyTracks.map<Track>((track) => {
    logger.info(
      `Storing non existing track ${track.name} by ${track.artists[0]?.name}`,
    );
    return {
      ...track,
      album: track.album.id,
      artists: track.artists.map((e) => e.id),
    };
  });
  Metrics.ingestedTracksTotal.inc({ user: userId }, tracks.length);

  return tracks;
};

export const getAlbums = async (userId: string, ids: string[]) => {
  const client = new SpotifyAPI(userId);
  const spotifyAlbums = compact(await client.getAlbums(ids));

  const albums: Album[] = spotifyAlbums.map((alb) => {
    logger.info(
      `Storing non existing album ${alb.name} by ${alb.artists[0]?.name}`,
    );

    return { ...alb, artists: alb.artists.map((art) => art.id) };
  });
  Metrics.ingestedAlbumsTotal.inc({ user: userId }, albums.length);

  return albums;
};

export const getArtists = async (userId: string, ids: string[]) => {
  const client = new SpotifyAPI(userId);
  const spotifyArtists = compact(await client.getArtists(ids));

  for (const spotifyArtist of spotifyArtists) {
    logger.info(`Storing non existing artist ${spotifyArtist.name}`);
  }

  Metrics.ingestedArtistsTotal.inc({ user: userId }, spotifyArtists.length);

  return spotifyArtists;
};

export const getTracksAlbumsArtists = async (
  userId: string,
  spotifyTracks: SpotifyTrack[],
) => {
  const ids = spotifyTracks.map((track) => track.id);
  const storedTracks: Track[] = await TrackModel.find({ id: { $in: ids } });
  const missingTrackIds = ids.filter(
    (id) =>
      !storedTracks.find((stored) => stored.id.toString() === id.toString()),
  );
  const recordings = spotifyTracks.map(({ id, external_ids }) => ({
    id,
    external_ids,
  }));

  if (missingTrackIds.length === 0) {
    return { tracks: [], albums: [], artists: [], recordings };
  }

  // The API/import resolver already supplied full track objects.
  const missing = new Set(missingTrackIds);
  const tracks: Track[] = uniqBy(spotifyTracks, (track) => track.id)
    .filter((track) => missing.has(track.id))
    .map((track) => ({
      ...track,
      album: track.album.id,
      artists: track.artists.map((artist) => artist.id),
    }));
  const relatedArtists = [...new Set(tracks.flatMap((track) => track.artists))];
  const relatedAlbums = [...new Set(tracks.map((track) => track.album))];
  Metrics.ingestedTracksTotal.inc({ user: userId }, tracks.length);

  const storedAlbums: Album[] = await AlbumModel.find({
    id: { $in: relatedAlbums },
  });
  const missingAlbumIds = relatedAlbums.filter(
    (alb) =>
      !storedAlbums.find((salb) => salb.id.toString() === alb.toString()),
  );

  const storedArtists: Artist[] = await ArtistModel.find({
    id: { $in: relatedArtists },
  });
  const missingArtistIds = relatedArtists.filter(
    (alb) =>
      !storedArtists.find((salb) => salb.id.toString() === alb.toString()),
  );

  const albums =
    missingAlbumIds.length > 0 ? await getAlbums(userId, missingAlbumIds) : [];
  const artists =
    missingArtistIds.length > 0
      ? await getArtists(userId, missingArtistIds)
      : [];

  return { tracks, albums, artists, recordings };
};

/** Enrich old catalog entries without replacing their release metadata. */
export async function storeRecordingIds(
  tracks: Pick<Track, "id" | "external_ids">[],
) {
  const recordings = uniqBy(tracks, (track) => track.id).filter(
    (track) => track.external_ids?.isrc,
  );
  if (!recordings.length) return;
  await TrackModel.bulkWrite(
    recordings.map((track) => ({
      updateOne: {
        filter: { id: track.id, "external_ids.isrc": { $in: [null, ""] } },
        update: {
          $set: {
            "external_ids.isrc": track.external_ids!.isrc!.toUpperCase(),
          },
        },
      },
    })),
  );
}

export async function storeTrackAlbumArtist({
  tracks,
  albums,
  artists,
  recordings,
}: {
  tracks?: Track[];
  albums?: Album[];
  artists?: Artist[];
  recordings?: Pick<Track, "id" | "external_ids">[];
}) {
  if (tracks) {
    await Promise.all(
      uniqBy(tracks, (item) => item.id).map((track) =>
        TrackModel.updateOne(
          { id: track.id },
          { $setOnInsert: track },
          { upsert: true },
        ),
      ),
    );
  }
  if (albums) {
    await Promise.all(
      uniqBy(albums, (item) => item.id).map((album) =>
        AlbumModel.updateOne(
          { id: album.id },
          { $setOnInsert: album },
          { upsert: true },
        ),
      ),
    );
  }
  if (artists) {
    await Promise.all(
      uniqBy(artists, (item) => item.id).map((artist) =>
        ArtistModel.updateOne(
          { id: artist.id },
          { $setOnInsert: artist },
          { upsert: true },
        ),
      ),
    );
  }
  await storeRecordingIds(recordings ?? tracks ?? []);
}

export async function storeIterationOfLoop(
  userId: string,
  iterationTimestamp: number,
  tracks: Track[],
  albums: Album[],
  artists: Artist[],
  infos: Omit<Infos, "owner">[],
  recordings?: Pick<Track, "id" | "external_ids">[],
) {
  await storeTrackAlbumArtist({ tracks, albums, artists, recordings });

  await addTrackIdsToUser(userId, infos);

  await storeInUser("_id", new mongoose.Types.ObjectId(userId), {
    lastTimestamp: iterationTimestamp,
  });

  const min = minOfArray(infos, (item) => item.played_at.getTime());

  if (min) {
    const minInfo = infos[min.minIndex]?.played_at;
    if (minInfo) {
      await storeFirstListenedAtIfLess(userId, minInfo);
    }
  }
}
