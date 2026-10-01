import { AlbumModel, ArtistModel, TrackModel } from "../../database/Models";
import { Track, SpotifyTrack } from "../../database/schemas/track";
import {
  getTracksAlbumsArtists,
  storeTrackAlbumArtist,
} from "../../spotify/dbTools";
import { SpotifyAPI } from "../apis/spotifyApi";
import { longWriteDbLock } from "../lock";

export function spotifyTrackId(input: string) {
  const value = input.trim();
  if (/^[a-zA-Z0-9]{22}$/.test(value)) return value;
  const uri = /^spotify:track:([a-zA-Z0-9]{22})$/.exec(value);
  if (uri) return uri[1]!;
  try {
    const url = new URL(value);
    const path = /^\/(?:intl-[a-z-]+\/)?track\/([a-zA-Z0-9]{22})\/?$/.exec(
      url.pathname,
    );
    if (
      url.protocol === "https:" &&
      url.hostname === "open.spotify.com" &&
      path
    )
      return path[1]!;
  } catch {
    /* The validation message also covers malformed links. */
  }
  throw new Error("Paste a Spotify track link, track URI or track ID");
}

export async function selectedTrack(
  userId: string,
  id: string,
): Promise<Track> {
  const local = await TrackModel.findOne({ id }).lean();
  if (local) return local;
  const found = await new SpotifyAPI(userId).getTrack(id);
  if (!found || !found.artists[0] || found.id !== id)
    throw new Error(
      "This recording is unavailable. Choose another Spotify track.",
    );
  const metadata = await getTracksAlbumsArtists(userId, [found]);
  await longWriteDbLock.lock();
  try {
    await storeTrackAlbumArtist(metadata);
  } finally {
    longWriteDbLock.unlock();
  }
  return {
    ...found,
    album: found.album.id,
    artists: found.artists.map((a) => a.id),
  };
}

export async function trackDescriptions(tracks: Track[]) {
  const [artists, albums] = await Promise.all([
    ArtistModel.find({ id: { $in: tracks.flatMap((t) => t.artists) } })
      .select("id name")
      .lean(),
    AlbumModel.find({ id: { $in: tracks.map((t) => t.album) } })
      .select("id name")
      .lean(),
  ]);
  return tracks.map((track) => ({
    id: track.id,
    title: track.name,
    artists: track.artists.map(
      (id) => artists.find((a) => a.id === id)?.name ?? id,
    ),
    album: albums.find((a) => a.id === track.album)?.name ?? "",
    durationMs: track.duration_ms,
    isrc: track.external_ids?.isrc ?? null,
    url: `https://open.spotify.com/track/${track.id}`,
  }));
}

export async function reviewCandidates(userId: string, query: string) {
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const local = await TrackModel.find({
    name: { $regex: escaped, $options: "i" },
  })
    .limit(10)
    .lean();
  const candidates = await trackDescriptions(local);
  let searchUnavailable = false;
  try {
    const response = await new SpotifyAPI(userId).raw(
      `/search?q=${encodeURIComponent(query)}&type=track&limit=10`,
    );
    const found: SpotifyTrack[] = response.data?.tracks?.items ?? [];
    for (const track of found) {
      if (!track || candidates.some((c) => c.id === track.id)) continue;
      candidates.push({
        id: track.id,
        title: track.name,
        artists: track.artists.map((a) => a.name),
        album: track.album.name,
        durationMs: track.duration_ms,
        isrc: track.external_ids?.isrc ?? null,
        url: `https://open.spotify.com/track/${track.id}`,
      });
    }
  } catch {
    searchUnavailable = true;
  }
  return { candidates, searchUnavailable };
}
