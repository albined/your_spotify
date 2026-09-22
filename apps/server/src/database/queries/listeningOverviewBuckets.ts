import { calendarDate, startOfCalendarDate } from "../../tools/allTimeStart";
import { Timesplit } from "../../tools/types";
import { DAY_MS, HOUR_MS } from "./listeningTimelineTools";

export const overviewPeriods = [
  "Today",
  "This week",
  "This month",
  "This year",
  "Last 7 days",
  "Last 30 days",
  "Last 365 days",
  "All",
  "custom",
] as const;
export type OverviewPeriod = (typeof overviewPeriods)[number];
export type OverviewUnit =
  | Timesplit.hour
  | Timesplit.day
  | Timesplit.month
  | Timesplit.year
  | "week";

export function shiftDate(date: string, days: number) {
  return new Date(Date.parse(date) + days * DAY_MS).toISOString().slice(0, 10);
}

function nextMonth(date: string, years = false) {
  const value = new Date(date);
  if (years) value.setUTCFullYear(value.getUTCFullYear() + 1);
  else value.setUTCMonth(value.getUTCMonth() + 1);
  return value.toISOString().slice(0, 10);
}

// Preserve local wall time when moving between dates, including across DST.
// Month-end clamping makes Feb 29 comparable with Feb 28 in a non-leap year.
function previousYear(at: number, timezone: string) {
  const date = calendarDate(at, timezone);
  const year = Number(date.slice(0, 4)) - 1;
  const month = Number(date.slice(5, 7));
  const day = Math.min(
    Number(date.slice(8)),
    new Date(Date.UTC(year, month, 0)).getUTCDate(),
  );
  const target = `${year}-${date.slice(5, 7)}-${String(day).padStart(2, "0")}`;
  const clock = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const time = clock.format(at).split(":").map(Number);
  const midnight = startOfCalendarDate(target, timezone).getTime();
  const guess =
    midnight +
    time[0]! * HOUR_MS +
    time[1]! * 60_000 +
    time[2]! * 1000 +
    (at % 1000);
  // Correct for any clock transition between midnight and the requested time.
  const actual = clock.format(guess).split(":").map(Number);
  const adjustment =
    Date.parse(target) -
    Date.parse(calendarDate(guess, timezone)) +
    (time[0]! - actual[0]!) * HOUR_MS +
    (time[1]! - actual[1]!) * 60_000;
  const corrected = guess + adjustment;
  // If the wall time falls inside a spring-forward gap, use the later instant.
  return clock.format(corrected) === clock.format(at)
    ? corrected
    : Math.max(guess, corrected);
}

export function overviewPlan(
  requestedStart: Date,
  requestedEnd: Date,
  period: OverviewPeriod,
  timezone: string,
  now = Date.now(),
) {
  const end = Math.min(requestedEnd.getTime(), now);
  const today = calendarDate(end, timezone);
  const midnight = (date: string) =>
    startOfCalendarDate(date, timezone).getTime();
  let start = requestedStart.getTime();
  if (period === "Today") start = midnight(today);
  if (period === "This week")
    start = midnight(shiftDate(today, -new Date(today).getUTCDay()));
  if (period === "This month") start = midnight(`${today.slice(0, 7)}-01`);
  if (period === "This year") start = midnight(`${today.slice(0, 4)}-01-01`);
  const days = (end - start) / DAY_MS;
  const firstDate = calendarDate(start, timezone);
  const lastDate = calendarDate(Math.max(start, end - 1), timezone);
  const months =
    (Number(lastDate.slice(0, 4)) - Number(firstDate.slice(0, 4))) * 12 +
    Number(lastDate.slice(5, 7)) -
    Number(firstDate.slice(5, 7)) +
    1;
  const unit: OverviewUnit =
    period === "Today" || (period === "custom" && days <= 2)
      ? Timesplit.hour
      : period === "This year"
        ? Timesplit.month
        : period === "Last 365 days"
          ? "week"
          : days <= 60
            ? Timesplit.day
            : months <= 200
              ? Timesplit.month
              : Timesplit.year;
  const comparison =
    period === "All"
      ? null
      : period === "This year"
        ? "previousYear"
        : period === "Last 365 days"
          ? "previousPeriod"
          : days <= 60
            ? "average"
            : null;
  let date =
    unit === Timesplit.year
      ? `${firstDate.slice(0, 4)}-01-01`
      : unit === Timesplit.month
        ? `${firstDate.slice(0, 7)}-01`
        : firstDate;
  let cursor = unit === "week" ? start : midnight(date);
  if (unit === Timesplit.hour)
    cursor += Math.floor((start - cursor) / HOUR_MS) * HOUR_MS;
  const buckets: {
    start: number;
    end: number;
    fullStart: number;
    fullEnd: number;
    partial: boolean;
    fraction: number;
    referenceStart?: number;
    referenceEnd?: number;
  }[] = [];
  while (start < end && cursor < end && buckets.length < 200) {
    const nextDate =
      unit === Timesplit.year || unit === Timesplit.month
        ? nextMonth(date, unit === Timesplit.year)
        : shiftDate(date, 1);
    const next =
      unit === Timesplit.hour
        ? cursor + HOUR_MS
        : unit === "week"
          ? cursor + 7 * DAY_MS
          : midnight(nextDate);
    const from = Math.max(start, cursor);
    const to = Math.min(end, next);
    const referenceStart =
      comparison === "previousYear"
        ? previousYear(from, timezone)
        : comparison === "previousPeriod"
          ? from - (end - start)
          : undefined;
    const referenceEnd =
      comparison === "previousYear"
        ? previousYear(to, timezone)
        : comparison === "previousPeriod"
          ? to - (end - start)
          : undefined;
    buckets.push({
      start: from,
      end: to,
      fullStart: cursor,
      fullEnd: next,
      partial: from !== cursor || to !== next,
      fraction: (to - from) / (next - cursor),
      referenceStart,
      referenceEnd,
    });
    cursor = next;
    date = nextDate;
  }
  // Use complete local days before the selection; don't let its partial first
  // day contaminate the baseline or count an unobserved day as a quiet one.
  const averageEnd = midnight(firstDate);
  const averageStart = midnight(shiftDate(firstDate, -365));
  return {
    start,
    end,
    timezone,
    unit,
    comparison,
    buckets,
    averageStart,
    averageEnd,
  };
}
