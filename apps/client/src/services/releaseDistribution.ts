import { HEATMAP_LABEL_WIDTH, timelineMatrixLayout } from "./matrixLayout";

export interface ReleaseDistribution {
  start: number;
  end: number;
  count: number;
  width: number;
  timezone: string;
  totalPlays: number;
  unknownPlays: number;
  years: { year: number; hours: number; plays: number }[];
  decades: { decade: number; plays: number; hours: number[] }[];
}

export function decadeColor(year: number) {
  const decade = Math.floor(year / 10);
  return `hsl(${(((decade * 137.508) % 360) + 360) % 360} 58% 55%)`;
}

// Integer source-bin boundaries preserve every hour, including silent bins.
// Match artist eras cell sizing, with at most 480 cells in the release grid.
export function releaseMatrix(
  data: ReleaseDistribution,
  availableWidth: number,
) {
  const limit = Math.max(
    1,
    Math.min(
      64,
      Math.floor(480 / Math.max(1, data.decades.length)),
      Math.ceil((data.end - data.start) / 3600000),
    ),
  );
  const { columns, pitch } = timelineMatrixLayout(
    availableWidth,
    HEATMAP_LABEL_WIDTH,
    data.count,
    limit,
  );
  const rows = data.decades.map((row) => ({
    decade: row.decade,
    values: Array.from({ length: columns }, (_, col) =>
      row.hours
        .slice(
          Math.floor((col * data.count) / columns),
          Math.floor(((col + 1) * data.count) / columns),
        )
        .reduce((sum, hours) => sum + hours, 0),
    ),
  }));
  const maximum = Math.max(0, ...rows.flatMap((row) => row.values));
  return { columns, pitch, rows, maximum };
}
