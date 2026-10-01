import { Schema, Types } from "mongoose";

export interface Infos {
  owner: Types.ObjectId;
  id: string;
  albumId: string;
  primaryArtistId: string;
  artistIds: string[];
  durationMs: number;
  listenedMs?: number;
  timestampUncertain?: boolean;
  listeningSource?: "full-privacy" | "privacy" | "deezer";
  provider?: "spotify" | "deezer";
  sourceKeys?: string[];
  sourceEndedAt?: Date;
  durationImportId?: string;
  lastImportRow?: string;
  lastImportOutcome?: "added" | "updated" | "unchanged";
  lastImportDeltaMs?: number;
  recordingMappingId?: string;
  recordingRepair?: {
    importId: string;
    blacklistedBy?: string[];
    id: string;
    albumId: string;
    primaryArtistId: string;
    artistIds: string[];
    durationMs: number;
  };
  played_at: Date;
  blacklistedBy?: "artist";
}

export const InfosSchema = new Schema<Infos>(
  {
    owner: { type: Schema.Types.ObjectId, ref: "User", index: true },

    id: { type: String, index: true },
    albumId: { type: String, index: true },
    primaryArtistId: { type: String, index: true },
    artistIds: [{ type: String }],

    durationMs: { type: Number },
    listenedMs: { type: Number, min: 0 },
    timestampUncertain: Boolean,
    listeningSource: {
      type: String,
      enum: ["full-privacy", "privacy", "deezer"],
    },
    provider: { type: String, enum: ["spotify", "deezer"] },
    sourceKeys: { type: [String], default: undefined },
    sourceEndedAt: Date,
    durationImportId: String,
    lastImportRow: String,
    lastImportOutcome: String,
    lastImportDeltaMs: Number,
    recordingMappingId: String,
    recordingRepair: {
      type: new Schema(
        {
          importId: String,
          blacklistedBy: { type: [String], default: undefined },
          id: String,
          albumId: String,
          primaryArtistId: String,
          artistIds: [String],
          durationMs: Number,
        },
        { _id: false },
      ),
      default: undefined,
    },

    played_at: { type: Date, index: true },
    blacklistedBy: {
      type: [String],
      enum: ["artist"],
      required: false,
      default: undefined,
    },
  },
  { toJSON: { virtuals: true }, toObject: { virtuals: true } },
);

InfosSchema.index({ owner: 1, id: 1, played_at: 1 });
InfosSchema.index({ owner: 1, played_at: 1 });
InfosSchema.index(
  { owner: 1, sourceKeys: 1 },
  {
    unique: true,
    partialFilterExpression: { sourceKeys: { $type: "string" } },
  },
);

InfosSchema.virtual("track", {
  ref: "Track",
  localField: "id",
  foreignField: "id",
  justOne: true,
});

InfosSchema.virtual("album", {
  ref: "Album",
  localField: "albumId",
  foreignField: "id",
  justOne: true,
});

InfosSchema.virtual("artist", {
  ref: "Artist",
  localField: "primaryArtistId",
  foreignField: "id",
  justOne: true,
});
