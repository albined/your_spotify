export const DAY_MS = 86_400_000;
export const HOUR_MS = 3_600_000;

// Equal-width elapsed-time buckets keep the payload bounded at every zoom level.
// These are durations, not calendar days; date labels use the user's timezone.
export function timelineBounds(start: Date, end: Date, target: number) {
  const span = Math.max(1, end.getTime() - start.getTime());
  const count = Math.min(target, Math.max(1, Math.ceil(span / 3_600_000)));
  return {
    start: start.getTime(),
    end: end.getTime(),
    count,
    width: span / count,
  };
}

export type TimelineBounds = ReturnType<typeof timelineBounds>;

export function bucketExpression(bounds: TimelineBounds) {
  return {
    $min: [
      bounds.count - 1,
      {
        $floor: {
          $divide: [
            { $subtract: ["$played_at", new Date(bounds.start)] },
            bounds.width,
          ],
        },
      },
    ],
  };
}

export function denseHours(
  bounds: TimelineBounds,
  buckets: { _id: number; duration: number }[],
) {
  const values = Array<number>(bounds.count).fill(0);
  for (const bucket of buckets) {
    if (bucket._id >= 0 && bucket._id < bounds.count) {
      values[bucket._id] = bucket.duration / HOUR_MS;
    }
  }
  return values;
}

export function cumulativeHours(values: number[]) {
  let total = 0;
  return [0, ...values.map((value) => (total += value))];
}
