import { Artist } from "./types";

export type VisibilityArtist = Pick<Artist, "id" | "name" | "images">;
export interface ArtistVisibilityEntry {
  artistId: string;
  hidden: boolean;
  name: string;
  images: Artist["images"];
}
