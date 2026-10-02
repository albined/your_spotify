import { PipelineStage } from "mongoose";

import { User } from "./schemas/user";
import { StatisticsInfosModel } from "./StatisticsInfos";

export const reportedDuration = {
  $and: [
    { $isNumber: "$listenedMs" },
    { $gte: ["$listenedMs", 0] },
    { $lte: ["$listenedMs", Number.MAX_SAFE_INTEGER] },
  ],
};

/** Only transforms query results. Stored song lengths remain unchanged. */
export function statisticsFor(
  user?: Pick<User, "settings">,
  options: { includeHiddenArtists?: boolean } = {},
) {
  return {
    aggregate<T = any>(pipeline: PipelineStage[]) {
      const stages = [...pipeline];
      if (!user?.settings.useFullSongDurations) {
        // Preserve the initial indexed account/date filter.
        const offset = stages[0] && "$match" in stages[0] ? 1 : 0;
        stages.splice(offset, 0, {
          $set: {
            durationMs: {
              $cond: [reportedDuration, "$listenedMs", "$durationMs"],
            },
          },
        });
      }
      return StatisticsInfosModel.aggregate<T>(stages).option(options);
    },
  };
}
