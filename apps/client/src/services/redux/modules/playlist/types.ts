import { SpotifyImage } from "../../../types";

export interface Playlist {
  id: string;
  name: string;
  images: SpotifyImage[] | null;
}

export interface PlaylistTopSongsContext {
  type: "top";
  nb: number;
  interval: { start: number; end: number };
}

export interface PlaylistSingleSongContext {
  type: "specific";
  songIds: Array<string>;
}

export interface PlaylistTopArtistSongsContext {
  type: "top-artist";
  artistId: string;
  nb: number;
}

export type PlaylistContext =
  | PlaylistTopSongsContext
  | PlaylistSingleSongContext
  | PlaylistTopArtistSongsContext;

export type PlaylistContextFromType<T extends PlaylistContext["type"]> =
  Extract<PlaylistContext, { type: T }>;
