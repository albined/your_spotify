import { Artist } from "./types";

export interface ArtistGroup {
  id: string;
  name: string;
  memberIds: string[];
  imageArtistId: string;
  enabled: boolean;
  revision: number;
}

export interface ArtistGroupsData {
  groups: ArtistGroup[];
  artists: Artist[];
  members: Pick<Artist, "id" | "name" | "images">[];
}

export type ArtistGroupInput = Omit<ArtistGroup, "id" | "revision">;
