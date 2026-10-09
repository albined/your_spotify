import { DateId } from "./types";

export const fresh = (d: Date, eraseHour = false) => {
  const date = new Date(d.getTime());
  date.setMilliseconds(0);
  date.setSeconds(0);
  date.setMinutes(0);
  if (eraseHour) {
    date.setHours(0);
  }
  return date;
};

export const buildFromDateId = (dateId: DateId) => {
  const date = fresh(
    new Date(
      dateId.year,
      (dateId.month ?? 1) - 1,
      dateId.day ?? 1,
      dateId.hour ?? 0,
    ),
  );
  return date;
};

export const msToMinutes = (ms: number) => Math.floor(ms / 1000 / 60);

// A figure short enough for a third of a phone's width.
export const msToCompactDuration = (ms: number) => {
  const minutes = msToMinutes(ms);
  if (minutes < 100) return `${minutes} min`;
  const hours = minutes / 60;
  return `${hours < 10 ? Math.round(hours * 10) / 10 : Math.round(hours)} h`;
};

export const msToDuration = (ms: number) => {
  if (ms === 0) {
    return "0s";
  }

  const seconds = Math.floor((ms / 1000) % 60);
  const minutes = Math.floor((ms / (1000 * 60)) % 60);
  const hours = Math.floor((ms / (1000 * 60 * 60)) % 24);
  const days = Math.floor(ms / (1000 * 60 * 60 * 24));

  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  // Seconds are noise once a duration is measured in hours.
  if (seconds > 0 && days === 0 && hours === 0) parts.push(`${seconds}s`);

  return parts.join(" ");
};

export const getLastPeriod = (start: Date, end: Date) => {
  const diff = end.getTime() - start.getTime();
  const oldStart = new Date(start.getTime() - diff);
  const oldEnd = new Date(end.getTime() - diff);
  return { start: oldStart, end: oldEnd };
};

export const getPercentMore = (old: number, now: number) => {
  if (old === now) return 0;
  if (old === 0) {
    return 100;
  }
  if (now === 0) {
    return -100;
  }
  if (now > old) {
    return Math.floor((now / old - 1) * 100);
  }
  return Math.floor((1 - now / old) * 100) * -1;
};
