import { TimelineBounds } from "./listeningTimeline";

export type OverviewPeriod =
  | "Today"
  | "This week"
  | "This month"
  | "This year"
  | "Last 7 days"
  | "Last 30 days"
  | "Last 365 days"
  | "All"
  | "custom";

export interface ListeningOverview {
  start: number;
  end: number;
  timezone: string;
  unit: "hour" | "day" | "week" | "month" | "year";
  comparison: "average" | "previousYear" | "previousPeriod" | null;
  average: { hours: number; songs: number } | null;
  referenceStart?: number;
  referenceEnd?: number;
  buckets: {
    start: number;
    end: number;
    fullStart: number;
    fullEnd: number;
    partial: boolean;
    hours: number;
    songs: number;
    reference: { hours: number; songs: number } | null;
    referenceStart?: number;
    referenceEnd?: number;
  }[];
}

export interface PersonalArtistDiversity extends TimelineBounds {
  windowDays: number;
  values: (number | null)[];
}
