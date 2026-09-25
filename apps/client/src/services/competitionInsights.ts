import type { CompetitionTimeline } from "./listeningTimeline";

export interface CompetitionInsights extends CompetitionTimeline {
  windowDays: number;
  series: (CompetitionTimeline["series"][number] & {
    hours: number[];
    percentages: number[];
  })[];
}
