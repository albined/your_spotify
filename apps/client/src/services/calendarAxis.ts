const DAY = 86_400_000;
const HOUR = 3_600_000;

/** Choose calendar boundaries, never arbitrary elapsed-time fractions. */
export function calendarAxis(
  start: number,
  end: number,
  unit: "hour" | "day" | "week" | "month" | "year",
  timezone: string,
  width: number,
) {
  const span = Math.max(0, end - start);
  const mode =
    unit === "hour"
      ? "hour"
      : unit === "day"
        ? span <= 8 * DAY
          ? "weekday"
          : "day"
        : span < 2 * 366 * DAY && unit !== "year"
          ? "month"
          : "year";
  const format: Intl.DateTimeFormatOptions =
    mode === "hour"
      ? {
          hour: "2-digit",
          hourCycle: "h23",
          ...(span > DAY ? ({ day: "numeric", month: "short" } as const) : {}),
        }
      : mode === "weekday"
        ? { weekday: "short" }
        : mode === "day"
          ? { month: "short", day: "numeric" }
          : mode === "month"
            ? {
                month: "short",
                ...(span > 366 * DAY ? ({ year: "2-digit" } as const) : {}),
              }
            : { year: "numeric" };
  if (start === end) return { ticks: [start], format };
  const labelWidth =
    mode === "weekday"
      ? 40
      : mode === "year" || (mode === "month" && span <= 366 * DAY)
        ? 48
        : mode === "hour" && span > DAY
          ? 100
          : 64;
  const capacity = Math.max(
    2,
    Math.min(12, Math.floor((width - 72) / labelWidth)),
  );
  const date = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  // UTC dates below are calendar ordinals. Convert each chosen date back to
  // its local midnight; a DST day must not shift the following labels by 1h.
  const midnight = (ordinal: number) => {
    const key = new Date(ordinal).toISOString().slice(0, 10);
    let low = ordinal - 36 * HOUR;
    let high = ordinal + 36 * HOUR;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (date.format(middle) < key) low = middle + 1;
      else high = middle;
    }
    return low;
  };
  const first = new Date(date.format(start));
  const last = new Date(date.format(end));
  const steps =
    mode === "hour"
      ? [1, 2, 3, 6, 12, 24]
      : mode === "weekday"
        ? [1, 2, 5, 10]
        : mode === "day"
          ? [5, 10, 15, 31]
          : mode === "month"
            ? [1, 3, 6, 12]
            : [1, 2, 5, 10, 20, 50, 100];
  const clock = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  let ticks: number[] = [];
  for (const step of steps) {
    const candidates: number[] = [];
    if (mode === "hour") {
      const [, minute, second] = clock.format(start).split(":").map(Number);
      const origin = start - minute! * 60_000 - second! * 1000 - (start % 1000);
      for (let time = origin; time <= end; time += HOUR) {
        if (Number(clock.format(time).slice(0, 2)) % step === 0)
          candidates.push(time);
      }
    } else if (mode === "weekday" || mode === "day") {
      for (let time = first.getTime(); time <= last.getTime(); time += DAY) {
        const day = new Date(time).getUTCDate();
        if (day === 1 || day % step === 0) candidates.push(time);
      }
      // Prefer the first of the next month over a nearby 30th/31st label.
      ticks = candidates
        .filter((time, i) => {
          const next = candidates[i + 1];
          return (
            next === undefined ||
            next - time >= step * DAY * 0.65 ||
            new Date(next).getUTCDate() !== 1
          );
        })
        .map(midnight);
    } else {
      const cursor = new Date(
        Date.UTC(
          first.getUTCFullYear(),
          mode === "year" ? 0 : first.getUTCMonth(),
          1,
        ),
      );
      while (cursor <= last) {
        if (
          (mode === "year" ? cursor.getUTCFullYear() : cursor.getUTCMonth()) %
            step ===
          0
        )
          candidates.push(cursor.getTime());
        if (mode === "year") cursor.setUTCFullYear(cursor.getUTCFullYear() + 1);
        else cursor.setUTCMonth(cursor.getUTCMonth() + 1);
      }
    }
    if (mode !== "weekday" && mode !== "day")
      ticks = mode === "hour" ? candidates : candidates.map(midnight);
    ticks = ticks.filter((time) => time >= start && time <= end);
    if (ticks.length <= capacity) break;
  }
  return { ticks, format };
}
