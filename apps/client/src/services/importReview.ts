export type ReviewCategory =
  | "recording"
  | "legacy"
  | "timestamp"
  | "invalid"
  | "no-match";
export interface ReviewGroup {
  _id: string;
  title: string;
  artist: string;
  album?: string;
  isrc?: string;
  provider: string;
  savedTrackId?: string;
  noMatch?: boolean;
  count: number;
  sourceRows: number;
  listenedMs: number;
  timedCount: number;
  start: string | null;
  end: string | null;
  categories: ReviewCategory[];
}
export interface ReviewGroups {
  groups: ReviewGroup[];
  counts: { _id: ReviewCategory; count: number; sourceRows: number }[];
  groupCounts?: Partial<Record<ReviewCategory, number>>;
}
export interface TimingReview {
  rowId: string;
  token: string;
  canAdd: boolean;
  export: {
    at: string;
    listenedMs: number;
    estimated: boolean;
    track: ReviewCandidate;
  };
  candidates: {
    id: string;
    at: string;
    listenedMs: number;
    estimated: boolean;
    track: ReviewCandidate | null;
    canUse: boolean;
  }[];
  moreCandidates: boolean;
}
export interface ReviewCandidate {
  id: string;
  title: string;
  artists: string[];
  album: string;
  durationMs: number;
  isrc: string | null;
  url: string;
}
export interface ReviewSummary {
  added: number;
  updated: number;
  unchanged: number;
  ambiguous: number;
  deltaMs: number;
}
