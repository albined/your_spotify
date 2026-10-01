import { Schema } from "mongoose";

import { ImporterState } from "../../tools/importers/types";

export const ImporterStateSchema = new Schema<ImporterState>(
  {
    type: { type: String, required: true },
    total: { type: Number, required: true },
    current: { type: Number, default: 0 },
    metadata: [String],
    timezone: String,
    repairLegacyDeezer: { type: Boolean, default: false },
    deezerPolicyVersion: Number,
    estimated: Number,
    fingerprint: String,
    fingerprintVersion: Number,
    stage: String,
    summary: { type: Object },
    range: { type: Object },
    issueCounts: { type: Object },
    issues: { type: [Object], default: [] },
    error: String,
    backup: String,
    user: { type: Schema.Types.ObjectId, ref: "User" },
    status: {
      type: String,
      enum: ["ready", "progress", "success", "failure", "failure-removed"],
      default: "progress",
    },
  },
  { timestamps: true },
);
