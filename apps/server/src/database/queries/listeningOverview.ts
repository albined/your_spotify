import {
  allTimeStartAt,
  calendarDate,
  startOfCalendarDate,
  statisticsTimezone,
} from "../../tools/allTimeStart";
import { Timesplit } from "../../tools/types";
import { InfosModel } from "../Models";
import { User } from "../schemas/user";
import { overviewPlan, OverviewPeriod } from "./listeningOverviewBuckets";
import { HOUR_MS } from "./listeningTimelineTools";

interface Totals {
  hours: number;
  songs: number;
}

export async function getListeningOverview(
  user: User,
  start: Date,
  end: Date,
  period: OverviewPeriod,
) {
  const timezone = statisticsTimezone(user);
  const plan = overviewPlan(start, end, period, timezone);
  const { buckets } = plan;
  const match = { owner: user._id, blacklistedBy: { $exists: false } };
  const sums = {
    songs: { $sum: 1 },
    hours: {
      $sum: {
        $cond: [
          {
            $and: [
              { $isNumber: "$durationMs" },
              { $gt: ["$durationMs", 0] },
              { $lte: ["$durationMs", Number.MAX_SAFE_INTEGER] },
            ],
          },
          { $divide: ["$durationMs", HOUR_MS] },
          0,
        ],
      },
    },
  };
  const aggregate = async (ranges: { start: number; end: number }[]) => {
    if (!ranges.length) return [];
    const boundaries = [
      ranges[0]!.start,
      ...ranges.map((bucket) => bucket.end),
    ].map((at) => new Date(at));
    return InfosModel.aggregate<Totals & { _id: Date }>([
      {
        $match: {
          ...match,
          played_at: { $gte: boundaries[0], $lt: boundaries.at(-1) },
        },
      },
      {
        $bucket: {
          groupBy: "$played_at",
          boundaries,
          default: "outside",
          output: sums,
        },
      },
    ]).option({ maxTimeMS: 15_000 });
  };
  const [current, first] = await Promise.all([
    aggregate(buckets),
    plan.comparison && buckets.length
      ? InfosModel.findOne(match)
          .sort({ played_at: 1 })
          .select({ played_at: 1 })
          .lean()
      : null,
  ]);
  const coverage = first
    ? Math.max(
        startOfCalendarDate(
          calendarDate(first.played_at.getTime(), timezone),
          timezone,
        ).getTime(),
        allTimeStartAt(user)?.getTime() ?? -Infinity,
      )
    : Infinity;
  const averages = new Map<number, Totals>();
  const references = new Map<number, Totals>();
  let comparison = buckets.length ? plan.comparison : null;
  if (comparison === "average") {
    if (coverage > plan.averageStart) comparison = null;
    else {
      const rows = await InfosModel.aggregate<Totals & { _id: number }>([
        {
          $match: {
            ...match,
            played_at: {
              $gte: new Date(plan.averageStart),
              $lt: new Date(plan.averageEnd),
            },
          },
        },
        {
          $group: {
            _id:
              plan.unit === Timesplit.hour
                ? { $hour: { date: "$played_at", timezone } }
                : 0,
            ...sums,
          },
        },
      ]).option({ maxTimeMS: 15_000 });
      for (const row of rows)
        averages.set(row._id, {
          hours: row.hours / 365,
          songs: row.songs / 365,
        });
    }
  } else if (comparison) {
    const eligible = buckets.filter(
      (bucket) => bucket.referenceStart! >= coverage,
    );
    if (!eligible.length) comparison = null;
    else {
      const rows = await aggregate(
        eligible.map((bucket) => ({
          start: bucket.referenceStart!,
          end: bucket.referenceEnd!,
        })),
      );
      for (const row of rows) references.set(row._id.getTime(), row);
    }
  }
  const hour = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hour: "2-digit",
    hourCycle: "h23",
  });
  const totals = new Map(current.map((row) => [row._id.getTime(), row]));
  return {
    start: plan.start,
    end: plan.end,
    timezone,
    unit: plan.unit,
    comparison,
    average:
      comparison === "average" && plan.unit === Timesplit.day
        ? (averages.get(0) ?? { hours: 0, songs: 0 })
        : null,
    referenceStart:
      comparison === "average" ? plan.averageStart : buckets[0]?.referenceStart,
    referenceEnd:
      comparison === "average" ? plan.averageEnd : buckets.at(-1)?.referenceEnd,
    buckets: buckets.map((bucket) => {
      let reference: Totals | null = null;
      if (comparison === "average") {
        const average = averages.get(
          plan.unit === Timesplit.hour ? Number(hour.format(bucket.start)) : 0,
        );
        reference = {
          hours: (average?.hours ?? 0) * bucket.fraction,
          songs: (average?.songs ?? 0) * bucket.fraction,
        };
      } else if (comparison && bucket.referenceStart! >= coverage) {
        reference = references.get(bucket.referenceStart!) ?? {
          hours: 0,
          songs: 0,
        };
      }
      return {
        ...bucket,
        hours: totals.get(bucket.start)?.hours ?? 0,
        songs: totals.get(bucket.start)?.songs ?? 0,
        reference,
      };
    }),
  };
}
