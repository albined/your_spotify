import { useEffect, useState } from "react";

import { Artist } from "./types";

export interface ListeningSeries {
  id: string;
  name: string;
  images: Artist["images"];
  hours: number[];
  subtitle?: string;
  lineOnly?: boolean;
}

export type TopTimelineKind = "songs" | "albums" | "artists";
export type CompetitionMetric =
  | "hours"
  | "count"
  | "differentTracks"
  | "differentArtists";

export interface TopTimeline extends TimelineBounds {
  series: ListeningSeries[];
}

export interface CompetitionTimeline extends TimelineBounds {
  series: { id: string; name: string; values: number[] }[];
}

export function cumulativeTimelinePoints(
  bounds: TimelineBounds,
  series: number[][],
) {
  return Array.from({ length: bounds.count + 1 }, (_, index) => {
    const point: Record<string, number> = {
      timestamp: Math.min(bounds.end, bounds.start + index * bounds.width),
    };
    series.forEach((values, seriesIndex) => {
      point[`series${seriesIndex}`] = values[index] ?? 0;
    });
    return point;
  });
}

export interface TimelineBounds {
  start: number;
  end: number;
  width: number;
  count: number;
  timezone?: string | null;
}

export interface ListeningDistribution extends TimelineBounds {
  series: ListeningSeries[];
  totalHours: number[];
  newHours: number[];
  familiarHours: number[];
  topFiveShare: (number | null)[];
}

export interface ArtistTimeline extends TimelineBounds {
  total: number[];
  albums: ListeningSeries[];
  songs: ListeningSeries[];
  peaks: { days: number; start: string; end: string; hours: number }[];
  milestones: { hours: number; date: string }[];
  rediscoveries: { date: string; previous: string; gapDays: number }[];
}

export type DistributionMode = "hours" | "share" | "cumulative";

// Weight partial buckets at the edge of the smoothing window. Divide by the
// available span so early points don't implicitly include unobserved history.
export function rollingDailyAverage(values: number[], width: number) {
  const window = 28 * 86_400_000;
  return values.map((_, index) => {
    const end = (index + 1) * width;
    const start = Math.max(0, end - window);
    let sum = 0;
    for (let bucket = Math.floor(start / width); bucket <= index; bucket += 1) {
      const overlap =
        Math.min(end, (bucket + 1) * width) - Math.max(start, bucket * width);
      sum += ((values[bucket] ?? 0) * overlap) / width;
    }
    return sum / ((end - start) / 86_400_000);
  });
}

export function distributionPoints(
  result: ListeningDistribution,
  mode: DistributionMode,
  smooth: boolean,
) {
  const values = result.series.map((item) =>
    smooth && mode !== "cumulative"
      ? rollingDailyAverage(item.hours, result.width)
      : item.hours,
  );
  const cumulative = result.series.map(() => 0);
  const points = Array.from({ length: result.count }, (_, index) => {
    const total = values.reduce((sum, item) => sum + item[index]!, 0);
    const point: Record<string, number> = {
      timestamp: Math.min(
        result.end,
        result.start + (index + 1) * result.width,
      ),
    };
    values.forEach((item, series) => {
      cumulative[series]! += item[index]!;
      point[`series${series}`] =
        mode === "share"
          ? total
            ? (item[index]! / total) * 100
            : 0
          : mode === "cumulative"
            ? cumulative[series]!
            : item[index]!;
    });
    return point;
  });
  if (mode === "cumulative") {
    points.unshift(
      Object.fromEntries([
        ["timestamp", result.start],
        ...result.series.map((_, index) => [`series${index}`, 0]),
      ]),
    );
  }
  return points;
}

// Keep stale responses from overwriting a newly selected artist/date range.
export function useListeningRequest<T>(request: () => Promise<{ data: T }>) {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<{
    request: typeof request;
    data?: T;
    error?: boolean;
  }>();
  useEffect(() => {
    let active = true;
    setState(undefined);
    request().then(
      ({ data }) => {
        if (active) setState({ request, data });
      },
      () => {
        if (active) setState({ request, error: true });
      },
    );
    return () => {
      active = false;
    };
  }, [request, attempt]);
  return {
    data: state?.request === request ? state.data : undefined,
    error: state?.request === request && state.error,
    retry: () => setAttempt((value) => value + 1),
  };
}
