import type { TimelineBounds } from "./listeningTimeline";

export type ListeningItemKind = "song" | "album" | "artist";

export interface DetailListeningData extends TimelineBounds {
  timezone: string;
  days: { date: string; hours: number }[];
  activity: [number, number][];
  tracks: { id: string; name: string; bins: [number, number][] }[];
  timeOfDay: { artist: number[]; overall: number[] } | null;
}

const DAY = 86_400_000;
const SAMPLES = 512;

export function activityBandwidth(span: number) {
  return Math.min(28 * DAY, Math.max(Math.min(DAY, span / 8), span / 73));
}

// Normalize each truncated Gaussian over the visible range: the area under the
// curve is the recorded listening time, including plays at either boundary.
export function listeningRate(
  data: Pick<DetailListeningData, "start" | "end" | "width" | "activity">,
) {
  const span = data.end - data.start;
  if (span <= 0) return [];
  const step = span / (SAMPLES - 1);
  const sigma = activityBandwidth(span);
  const radius = Math.ceil((sigma * 4) / step);
  const values = new Float64Array(SAMPLES);
  for (const [bin, hours] of data.activity) {
    if (!Number.isFinite(hours) || hours <= 0) continue;
    const center = ((bin + 0.5) * data.width) / step;
    const first = Math.max(0, Math.floor(center - radius));
    const last = Math.min(SAMPLES - 1, Math.ceil(center + radius));
    const weights = Array.from(
      { length: Math.max(0, last - first + 1) },
      (_, i) => Math.exp(-0.5 * (((first + i - center) * step) / sigma) ** 2),
    );
    const area = weights.reduce(
      (sum, value, i) =>
        sum +
        (value *
          (first + i === 0 || first + i === SAMPLES - 1 ? 0.5 : 1) *
          step) /
          DAY,
      0,
    );
    if (!area) continue;
    weights.forEach((value, i) => {
      values[first + i]! += (hours * value) / area;
    });
  }
  return Array.from(values, (value, i) => ({
    timestamp: data.start + i * step,
    series0: value,
  }));
}

export function hourlyComparison(
  data: NonNullable<DetailListeningData["timeOfDay"]>,
) {
  const artistTotal = data.artist.reduce((sum, value) => sum + value, 0);
  const overallTotal = data.overall.reduce((sum, value) => sum + value, 0);
  return Array.from({ length: 24 }, (_, hour) => ({
    hour: String(hour).padStart(2, "0"),
    artist: artistTotal ? (100 * (data.artist[hour] ?? 0)) / artistTotal : 0,
    overall: overallTotal
      ? (100 * (data.overall[hour] ?? 0)) / overallTotal
      : 0,
  }));
}

export function mergeListeningBins(
  bins: [number, number][],
  sourceCount: number,
  columns: number,
) {
  const values = Array<number>(columns).fill(0);
  for (const [bin, hours] of bins) {
    const col = Math.min(
      columns - 1,
      Math.ceil(((bin + 1) * columns) / sourceCount) - 1,
    );
    values[col]! += hours;
  }
  return values;
}
