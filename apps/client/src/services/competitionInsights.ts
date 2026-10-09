import type { CompetitionTimeline } from "./listeningTimeline";

export interface CompetitionInsights extends CompetitionTimeline {
  windowDays: number;
  series: (CompetitionTimeline["series"][number] & {
    hours: number[];
    percentages: number[];
  })[];
  // What each pair of two or three people has in common over a trailing
  // window, as a share of their listening; null while either has none.
  overlap: {
    windowDays: number;
    pairs: { members: [number, number]; values: (number | null)[] }[];
  } | null;
}
