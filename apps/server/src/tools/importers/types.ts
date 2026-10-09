import { Types } from "mongoose";

import { ImportSource } from "./records";

export type ImporterStateStatus =
  | "ready"
  | "progress"
  | "success"
  | "failure"
  | "failure-removed";
export type ImportStage =
  | "ready"
  | "backup"
  | "importing"
  | "complete"
  | "failed";
export interface ImportSummary {
  added: number;
  updated: number;
  unchanged: number;
  short: number;
  invalid: number;
  unresolved: number;
  noMatch: number;
  duplicates: number;
  excluded: number;
  ambiguous: number;
  deltaMs: number;
}
export const emptySummary = (): ImportSummary => ({
  added: 0,
  updated: 0,
  unchanged: 0,
  short: 0,
  invalid: 0,
  unresolved: 0,
  noMatch: 0,
  duplicates: 0,
  excluded: 0,
  ambiguous: 0,
  deltaMs: 0,
});
export interface ImporterState {
  _id: Types.ObjectId;
  user: Types.ObjectId;
  type: ImportSource;
  current: number;
  total: number;
  status: ImporterStateStatus;
  metadata: string[];
  timezone?: string;
  repairLegacyDeezer?: boolean;
  deezerPolicyVersion?: number;
  estimated?: number;
  fingerprint?: string;
  fingerprintVersion?: number;
  stage?: ImportStage;
  summary?: ImportSummary;
  range?: { start: string | null; end: string | null };
  issueCounts?: {
    recording: number;
    legacy: number;
    timestamp: number;
    invalid: number;
  };
  issues?: { row: number; title: string; reason: string }[];
  error?: string;
  backup?: string;
  createdAt?: Date;
  updatedAt?: Date;
}
