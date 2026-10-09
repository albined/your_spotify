import { AlbumModel, TrackModel } from "../Models";
import { getStatisticsArtists, normalizeArtistCredits } from "./artistGroups";

export type ItemKind = "songs" | "albums" | "artists";

// The field of a play that names its song, album or artist.
export const itemField = {
  songs: "id",
  albums: "albumId",
  artists: "primaryArtistId",
} as const;

/**
 * Names, credits and artwork of songs, albums or artists. The returned lookup
 * also answers for an item that is no longer stored.
 */
export async function getItemDetails(kind: ItemKind, ids: string[]) {
  const [rawTracks, rawAlbums, artists] = await Promise.all([
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
    kind === "artists" ? getStatisticsArtists(ids) : [],
  ]);
  const [tracks, albums] = await Promise.all([
    normalizeArtistCredits(rawTracks),
    normalizeArtistCredits(rawAlbums),
  ]);
  const [covers, credits] = await Promise.all([
    tracks.length
      ? AlbumModel.find({ id: { $in: tracks.map((track) => track.album) } })
          .select("id images")
          .lean()
      : [],
    kind !== "artists"
      ? getStatisticsArtists(
          [...tracks, ...albums].flatMap((item) => item.artists),
        )
      : [],
  ]);
  const cover = new Map(covers.map((album) => [album.id, album.images]));
  const credit = new Map(credits.map((artist) => [artist.id, artist.name]));
  const credited = (item: { artists: string[] }) =>
    item.artists
      .map((id) => credit.get(id))
      .filter(Boolean)
      .join(", ");
  const details = new Map<
    string,
    { name: string; subtitle?: string; images: (typeof artists)[0]["images"] }
  >();
  for (const artist of artists)
    details.set(artist.id, { name: artist.name, images: artist.images });
  for (const album of albums)
    details.set(album.id, {
      name: album.name,
      subtitle: credited(album),
      images: album.images,
    });
  for (const track of tracks)
    details.set(track.id, {
      name: track.name,
      subtitle: credited(track),
      images: cover.get(track.album) ?? [],
    });
  return (id: string) =>
    details.get(id) ?? { name: `Unknown ${kind.slice(0, -1)}`, images: [] };
}
