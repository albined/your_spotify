export interface ListeningHeatmapsData {
  start: number;
  end: number;
  timezone: string;
  days: { date: string; hours: number }[];
  rhythms: { weekday: number; hour: number; hours: number }[];
}

export interface ArtistActivityData {
  start: number;
  end: number;
  timezone: string;
  artists: {
    id: string;
    name: string;
    image?: string;
    hours: number;
    activeDays: number;
    peakHoursPerDay: number;
  }[];
}

export interface HeatCell {
  value: number;
  label: string;
}
export interface HeatRow {
  id: string;
  label: string;
  cells: (HeatCell | null)[];
}

const DAY = 86_400_000;
export const weekdays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
export const formatHours = (value: number) =>
  `${value > 0 && value < 0.01 ? "<0.01" : value.toLocaleString(undefined, { maximumFractionDigits: 2 })} h`;

function localDate(time: number, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(time);
  const part = (type: string) => parts.find((p) => p.type === type)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}
function dayKey(time: number) {
  return new Date(time).toISOString().slice(0, 10);
}
function monday(time: number) {
  return time - ((new Date(time).getUTCDay() + 6) % 7) * DAY;
}

export function calendarGrid(data: ListeningHeatmapsData): {
  rows: HeatRow[];
  columns: string[];
} {
  const first = Date.parse(localDate(data.start, data.timezone));
  const last = Date.parse(localDate(data.end - 1, data.timezone));
  const values = new Map(data.days.map((day) => [day.date, day.hours]));
  const month = new Intl.DateTimeFormat(undefined, {
    month: "short",
    timeZone: "UTC",
  });
  const date = new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
  if (last - first < 400 * DAY) {
    const origin = monday(first);
    const count = Math.floor((last - origin) / (7 * DAY)) + 1;
    let previousMonth = "";
    const columns = Array.from({ length: count }, (_, col) => {
      const time = Math.max(first, origin + col * 7 * DAY);
      const key = dayKey(time).slice(0, 7);
      const label =
        key === previousMonth
          ? ""
          : `${month.format(time)}${new Date(time).getUTCMonth() === 0 ? ` ${new Date(time).getUTCFullYear()}` : ""}`;
      previousMonth = key;
      return label;
    });
    return {
      columns,
      rows: weekdays.map((label, row) => ({
        id: label,
        label,
        cells: Array.from({ length: count }, (_, col) => {
          const time = origin + (col * 7 + row) * DAY;
          if (time < first || time > last) return null;
          const value = values.get(dayKey(time)) ?? 0;
          return {
            value,
            label: `${date.format(time)} · ${formatHours(value)}`,
          };
        }),
      })),
    };
  }
  const startYear = new Date(first).getUTCFullYear();
  const endYear = new Date(last).getUTCFullYear();
  const weekly = endYear - startYear < 8;
  const stride = weekly
    ? 1
    : Math.max(1, Math.ceil((endYear - startYear + 1) / 20));
  const rows = new Map<number, HeatRow>();
  const columns = weekly
    ? Array.from({ length: 53 }, (_, i) =>
        [0, 9, 18, 27, 36, 45].includes(i) ? `W${i + 1}` : "",
      )
    : Array.from({ length: 12 }, (_, i) => month.format(Date.UTC(2000, i, 1)));
  const ranges = new Map<string, { first: number; last: number }>();
  for (let time = first; time <= last; time += DAY) {
    let year = new Date(time).getUTCFullYear();
    let column = new Date(time).getUTCMonth();
    if (weekly) {
      const weekStart = monday(time);
      year = new Date(weekStart + 3 * DAY).getUTCFullYear();
      column = Math.round(
        (weekStart - monday(Date.UTC(year, 0, 4))) / (7 * DAY),
      );
    } else year = startYear + Math.floor((year - startYear) / stride) * stride;
    let row = rows.get(year);
    if (!row) {
      row = {
        id: String(year),
        label:
          stride > 1
            ? `${year}–${Math.min(endYear, year + stride - 1)}`
            : String(year),
        cells: Array(columns.length).fill(null),
      };
      rows.set(year, row);
    }
    const key = `${year}:${column}`;
    const range = ranges.get(key) ?? { first: time, last: time };
    range.last = time;
    ranges.set(key, range);
    const value =
      (row.cells[column]?.value ?? 0) + (values.get(dayKey(time)) ?? 0);
    row.cells[column] = {
      value,
      label: `${weekly ? `${date.format(range.first)} – ${date.format(range.last)}` : `${month.format(time)} ${row.label}`} · ${formatHours(value)}`,
    };
  }
  return {
    rows: [...rows.values()].sort((a, b) => a.id.localeCompare(b.id)),
    columns,
  };
}
