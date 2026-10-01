export type ImporterStateStatus =
  | "ready"
  | "progress"
  | "success"
  | "failure"
  | "failure-removed";

export enum ImporterStateType {
  privacy = "privacy",
  fullPrivacy = "full-privacy",
  deezer = "deezer",
}

export interface BaseImporterState {
  _id: string;
  createdAt: string;
  user: string;
  type: string;
  current: number;
  total: number;
  status: ImporterStateStatus;
  stage?: "ready" | "backup" | "importing" | "complete" | "failed";
  timezone?: string;
  repairLegacyDeezer?: boolean;
  deezerPolicyVersion?: number;
  estimated?: number;
  range?: { start: string | null; end: string | null };
  summary?: {
    added: number;
    updated: number;
    unchanged: number;
    short: number;
    invalid: number;
    unresolved: number;
    noMatch?: number;
    duplicates?: number;
    excluded?: number;
    ambiguous: number;
    deltaMs: number;
  };
  issueCounts?: {
    recording: number;
    legacy: number;
    timestamp: number;
    invalid: number;
  };
  issues?: { row: number; title: string; reason: string }[];
  error?: string;
  backup?: string;
}

export interface PrivacyImporterState extends BaseImporterState {
  type: ImporterStateType.privacy;
  metadata?: string[];
}

export interface FullPrivacyImporterState extends BaseImporterState {
  type: ImporterStateType.fullPrivacy;
  metadata?: string[];
}

export interface DeezerImporterState extends BaseImporterState {
  type: ImporterStateType.deezer;
  metadata?: string[];
}

export type ImporterState =
  | PrivacyImporterState
  | FullPrivacyImporterState
  | DeezerImporterState;
