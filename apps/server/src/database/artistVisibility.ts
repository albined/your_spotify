import { PipelineStage } from "mongoose";

import { UserModel } from "./Models";

/** Build a per-owner read filter using original artist IDs, before grouping. */
export async function artistVisibilityFilter(owner?: unknown) {
  const users = await UserModel.find({
    ...(owner === undefined ? {} : { _id: owner }),
    "settings.artistVisibility.hidden": true,
  })
    .select("settings.artistVisibility")
    .lean();
  const excluded = users.map((user) => {
    const ids = (user.settings.artistVisibility ?? [])
      .filter((entry) => entry.hidden)
      .map((entry) => entry.artistId);
    return { owner: user._id, primaryArtistId: { $in: ids } };
  });
  return excluded.length ? { $nor: excluded } : null;
}

export function filterStatisticsPipeline(
  pipeline: PipelineStage[],
  filter: NonNullable<Awaited<ReturnType<typeof artistVisibilityFilter>>>,
) {
  const first = pipeline[0];
  if (first && "$match" in first)
    first.$match = { $and: [first.$match, filter] };
  else pipeline.unshift({ $match: filter });
  // A join back into raw listening events must apply the same read filter.
  const visit = (stages: PipelineStage[]) => {
    for (const stage of stages) {
      if ("$facet" in stage) Object.values(stage.$facet).forEach(visit);
      if ("$lookup" in stage) {
        const lookup = stage.$lookup;
        if (lookup.from === "infos") {
          lookup.pipeline ??= [];
          filterStatisticsPipeline(lookup.pipeline, filter);
        } else if (lookup.pipeline) visit(lookup.pipeline);
      }
    }
  };
  visit(pipeline);
}
