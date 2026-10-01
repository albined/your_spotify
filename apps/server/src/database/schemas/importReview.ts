import { Schema, Types } from "mongoose";

import { ImportRecord } from "../../tools/importers/records";

export type ReviewCategory = "recording" | "legacy" | "timestamp" | "invalid";
export type ReviewView = ReviewCategory | "no-match";
export interface ImportReview {
  owner: Types.ObjectId;
  key: string;
  recordingKey: string;
  groupKey: string;
  category: ReviewCategory;
  status: "pending" | "resolved" | "no-match";
  record: ImportRecord;
  occurrences: number;
  firstImportId: string;
  lastImportId: string;
  reason: string;
  resolvedBy?: string;
  outcome?: string;
  deltaMs?: number;
  policyVersion?: number;
  excluded?: boolean;
}
export const ImportReviewSchema = new Schema<ImportReview>(
  {
    owner: { type: Schema.Types.ObjectId, required: true },
    key: { type: String, required: true },
    recordingKey: { type: String, required: true },
    groupKey: { type: String, required: true },
    category: {
      type: String,
      enum: ["recording", "legacy", "timestamp", "invalid"],
    },
    status: {
      type: String,
      enum: ["pending", "resolved", "no-match"],
      default: "pending",
    },
    record: {
      type: new Schema(
        {
          key: String,
          source: String,
          provider: String,
          at: Date,
          precisionMs: Number,
          listenedMs: { type: Number, default: null },
          spotifyId: String,
          title: String,
          artist: String,
          album: String,
          sourceTimestamp: String,
          sourceListeningTime: String,
          isrc: String,
          invalid: String,
          ambiguous: Boolean,
        },
        { _id: false },
      ),
      required: true,
    },
    occurrences: Number,
    firstImportId: String,
    lastImportId: String,
    reason: String,
    resolvedBy: String,
    outcome: String,
    deltaMs: Number,
    policyVersion: Number,
    excluded: Boolean,
  },
  { timestamps: true },
);
ImportReviewSchema.index({ owner: 1, key: 1 }, { unique: true });
ImportReviewSchema.index({ owner: 1, status: 1, category: 1, groupKey: 1 });
ImportReviewSchema.index({ owner: 1, "record.key": 1 });
ImportReviewSchema.index({ owner: 1, recordingKey: 1, status: 1 });

export interface ImportMapping {
  owner: Types.ObjectId;
  recordingKey: string;
  trackId?: string;
  noMatch?: boolean;
  sourceTitle: string;
  sourceArtist: string;
}
export const ImportMappingSchema = new Schema<ImportMapping>(
  {
    owner: { type: Schema.Types.ObjectId, required: true },
    recordingKey: { type: String, required: true },
    trackId: {
      type: String,
      required: function (this: ImportMapping) {
        return !this.noMatch;
      },
    },
    noMatch: Boolean,
    sourceTitle: String,
    sourceArtist: String,
  },
  { timestamps: true },
);
ImportMappingSchema.index({ owner: 1, recordingKey: 1 }, { unique: true });
