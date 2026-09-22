import type { User } from "../database/schemas/user";
import { getWithDefault } from "./env";

export function statisticsTimezone(user: User) {
  return user.settings.timezone ?? getWithDefault("TIMEZONE", "Europe/Paris");
}

export function calendarDate(timestamp: number, timezone: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(timestamp);
}

/** Earliest instant on this local date, including days with no midnight. */
export function startOfCalendarDate(date: string, timezone: string) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const midnight = Date.parse(`${date}T00:00:00Z`);
  // All supported UTC offsets fit inside this window. Searching by local date
  // also handles DST gaps/overlaps without assuming a day is exactly 24 hours.
  let low = midnight - 36 * 3_600_000;
  let high = midnight + 36 * 3_600_000;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (formatter.format(middle) < date) low = middle + 1;
    else high = middle;
  }
  return new Date(low);
}

export function allTimeStartAt(user: User) {
  return user.settings.allTimeStartDate
    ? startOfCalendarDate(
        user.settings.allTimeStartDate,
        statisticsTimezone(user),
      )
    : null;
}
