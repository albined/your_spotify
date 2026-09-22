export interface ArtistDistribution {
  start: number;
  end: number;
  width: number;
  count: number;
  timezone: string;
  series: {
    id: string;
    name: string;
    image?: string;
    bins: [number, number][];
  }[];
}

const DAY = 86_400_000;
export const MAX_ARTISTS = 30;
const SAMPLES = 256;

// Five days per year, scaled continuously as the selected period changes.
export function distributionBandwidth(span: number) {
  return span / 73;
}

export function artistColor(id: string) {
  let hash = 2166136261;
  for (const char of id) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return `hsl(${(hash >>> 0) % 360} 52% 57%)`;
}

export function buildArtistStream(data: ArtistDistribution) {
  const span = data.end - data.start;
  if (span <= 0) return { bands: [], maximum: 0, samples: SAMPLES };
  const step = span / (SAMPLES - 1);
  const sigma = distributionBandwidth(span);
  const radius = Math.ceil((sigma * 4) / step);
  // Cache kernels once per occupied time bin and share across artists.
  const kernels = new Map<number, { index: number; weights: number[] }>();
  // The API returns this list in descending listening-time order. Keep this
  // guard so an older response cannot make the chart expensive again.
  const streams = data.series
    .slice(0, MAX_ARTISTS)
    .map((artist) => {
      const values = new Float64Array(SAMPLES);
      let total = 0;
      for (const [bin, hours] of artist.bins) {
        if (!Number.isFinite(hours) || hours <= 0) continue;
        total += hours;
        let kernel = kernels.get(bin);
        if (!kernel) {
          const center = ((bin + 0.5) * data.width) / step;
          const index = Math.max(0, Math.floor(center - radius));
          const end = Math.min(SAMPLES - 1, Math.ceil(center + radius));
          const weights = Array.from({ length: end - index + 1 }, (_, i) => {
            const distance = ((index + i - center) * step) / sigma;
            return Math.exp(-0.5 * distance * distance);
          });
          // Normalize the visible part of each kernel using trapezoidal area.
          // Even listens at either boundary retain their full recorded duration.
          const area = weights.reduce((sum, weight, i) => {
            const endpoint = index + i === 0 || index + i === SAMPLES - 1;
            return sum + (weight * (endpoint ? 0.5 : 1) * step) / DAY;
          }, 0);
          kernel = { index, weights: weights.map((weight) => weight / area) };
          kernels.set(bin, kernel);
        }
        kernel.weights.forEach((weight, i) => {
          values[kernel.index + i]! += hours * weight;
        });
      }
      let peak = 0;
      values.forEach((value, i) => {
        if (value > values[peak]!) peak = i;
      });
      return { artist, values, total, peak, color: artistColor(artist.id) };
    })
    .filter((stream) => stream.total > 0);

  // Keep membership fixed; balance artists around the center in peak-date order.
  const bottom: typeof streams = [];
  const top: typeof streams = [];
  let bottomTotal = 0;
  let topTotal = 0;
  streams.sort(
    (a, b) => a.peak - b.peak || a.artist.id.localeCompare(b.artist.id),
  );
  for (const stream of streams) {
    if (bottomTotal < topTotal) {
      bottom.push(stream);
      bottomTotal += stream.total;
    } else {
      top.push(stream);
      topTotal += stream.total;
    }
  }
  const totals = new Float64Array(SAMPLES);
  for (const stream of streams)
    stream.values.forEach((v, i) => {
      totals[i]! += v;
    });
  const baseline = totals.map((total) => -total / 2);
  const bands = [...bottom.reverse(), ...top].map((stream) => {
    const lower = baseline.slice();
    stream.values.forEach((value, i) => {
      baseline[i]! += value;
    });
    return { ...stream, lower, upper: baseline.slice() };
  });
  return { bands, maximum: Math.max(...totals), samples: SAMPLES };
}
