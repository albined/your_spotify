import { model, PipelineStage } from "mongoose";

import { artistGroups, GroupArtist } from "./queries/artistGroups";
import { InfosSchema } from "./schemas/info";

function mappedId(value: unknown, artists: GroupArtist[]) {
  return {
    $switch: {
      branches: artists.map((artist) => ({
        case: { $in: [value, { $literal: artist.memberIds }] },
        then: { $literal: artist.id },
      })),
      default: value,
    },
  };
}

function mappedIds(value: unknown, artists: GroupArtist[]) {
  // Preserve primary-credit order while collapsing two aliases on one credit.
  return {
    $reduce: {
      input: {
        $map: {
          input: { $ifNull: [value, []] },
          as: "credit",
          in: mappedId("$$credit", artists),
        },
      },
      initialValue: [],
      in: {
        $cond: [
          { $in: ["$$this", "$$value"] },
          "$$value",
          { $concatArrays: ["$$value", ["$$this"]] },
        ],
      },
    },
  };
}

export function expandArtistMatch(
  match: Record<string, any>,
  artists: GroupArtist[],
): Record<string, any> {
  const expanded = (id: string) =>
    artists.find((artist) => artist.id === id || artist.memberIds.includes(id))
      ?.memberIds ?? [id];
  return Object.fromEntries(
    Object.entries(match).map(([key, value]) => {
      if (key === "$and" || key === "$or" || key === "$nor")
        return [
          key,
          value.map((part: Record<string, any>) =>
            expandArtistMatch(part, artists),
          ),
        ];
      if (key !== "primaryArtistId") return [key, value];
      if (typeof value === "string") return [key, { $in: expanded(value) }];
      if (value?.$in)
        return [
          key,
          { ...value, $in: [...new Set(value.$in.flatMap(expanded))] },
        ];
      return [key, value];
    }),
  );
}

// Only statistics opt into this model. Ingestion, imports, deduplication and
// blacklist writes continue to use InfosModel and untouched Spotify identities.
const schema = InfosSchema.clone();
schema.pre("aggregate", async function () {
  const { artists } = await artistGroups();
  if (!artists.length) return;
  const pipeline = this.pipeline();
  if (pipeline.some((stage) => "$out" in stage || "$merge" in stage))
    throw new Error("Statistics aggregations are read-only.");
  const first = pipeline[0];
  const offset = first && "$match" in first ? 1 : 0;
  if (first && "$match" in first)
    first.$match = expandArtistMatch(first.$match, artists);
  pipeline.splice(offset, 0, {
    $set: {
      primaryArtistId: mappedId("$primaryArtistId", artists),
      artistIds: mappedIds("$artistIds", artists),
    },
  });
  const transform = (stages: PipelineStage[]): PipelineStage[] =>
    stages.flatMap((stage): PipelineStage[] => {
      if ("$facet" in stage) {
        for (const [key, value] of Object.entries(stage.$facet))
          stage.$facet[key] = transform(value) as typeof value;
      }
      if (!("$lookup" in stage)) return [stage];
      const lookup = stage.$lookup;
      if (lookup.pipeline)
        lookup.pipeline = transform(lookup.pipeline) as typeof lookup.pipeline;
      if (lookup.from === "tracks" || lookup.from === "albums") {
        lookup.pipeline = [
          { $set: { artists: mappedIds("$artists", artists) } },
          ...(lookup.pipeline ?? []),
        ];
      }
      if (lookup.from !== "artists") return [stage];
      const source = lookup.localField
        ? `$${lookup.localField}`
        : lookup.let?.id;
      if (!source)
        throw new Error("Artist lookup must declare its artist IDs.");
      const ids = { $cond: [{ $isArray: source }, source, [source]] };
      if (lookup.localField) lookup.localField = "__groupLookupIds";
      else lookup.let = { ...lookup.let, id: { $first: "$__groupLookupIds" } };
      return [
        { $set: { __groupLookupIds: mappedIds(ids, artists) } },
        stage,
        {
          $set: {
            [lookup.as]: {
              $concatArrays: [
                `$${lookup.as}`,
                {
                  $filter: {
                    input: { $literal: artists },
                    as: "artist",
                    cond: { $in: ["$$artist.id", "$__groupLookupIds"] },
                  },
                },
              ],
            },
          },
        },
        { $unset: "__groupLookupIds" },
      ];
    });
  const transformed = transform(pipeline);
  pipeline.splice(0, pipeline.length, ...transformed);
});
schema.pre("findOne", async function () {
  const { artists } = await artistGroups();
  if (artists.length)
    this.setQuery(expandArtistMatch(this.getQuery(), artists));
});

export const StatisticsInfosModel = model("StatisticsInfos", schema, "infos");
