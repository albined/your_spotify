import { Schema } from "mongoose";

export interface ArtistGroup {
  id: string;
  name: string;
  memberIds: string[];
  imageArtistId: string;
  enabled: boolean;
  revision: number;
}

export const ArtistGroupSchema = new Schema<ArtistGroup>({
  id: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  memberIds: { type: [String], required: true },
  imageArtistId: { type: String, required: true },
  enabled: { type: Boolean, default: true },
  revision: { type: Number, default: 1 },
});

// Membership remains reserved while a group is disabled. This also enforces
// non-overlap across concurrent admin edits, without relying on transactions.
ArtistGroupSchema.index({ memberIds: 1 }, { unique: true });
