import type { CompetitionTimeline } from "./listeningTimeline";

export interface CompetitionInsights extends CompetitionTimeline {
  series: (CompetitionTimeline["series"][number] & {
    hours: number[];
    percentages: number[];
  })[];
}
