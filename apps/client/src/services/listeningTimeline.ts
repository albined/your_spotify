import { startTransition, useEffect, useState } from "react";

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

export interface TopMovement {
  since: string | null;
  items: { id: string; change: number | null }[];
}

export interface CompetitionTimeline extends TimelineBounds {
  series: { id: string; name: string; values: number[] }[];
}

export interface CompetitionArtist {
  id: string;
  name: string;
  image?: string;
  minimumHours: number;
  totalHours: number;
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

export interface ArtistTimeline extends TimelineBounds {
  total: number[];
  albums: ListeningSeries[];
  songs: ListeningSeries[];
  milestones: { hours: number; date: string }[];
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
        // Chart rendering can yield to input while a response is displayed.
        if (active) startTransition(() => setState({ request, data }));
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
