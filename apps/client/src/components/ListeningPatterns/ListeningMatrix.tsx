import {
  DetailListeningData,
  mergeListeningBins,
} from "../../services/detailListening";
import { formatHours } from "../../services/listeningPatterns";
import { timelineMatrixLayout } from "../../services/matrixLayout";
import TitleCard from "../TitleCard";
import { Heatmap, usePlotWidth } from "./shared";

import s from "./index.module.css";

export default function ListeningMatrix({
  data,
  series,
  title,
  label,
  sortByPeak = false,
  rowWeight = 0,
}: {
  data: Pick<
    DetailListeningData,
    "start" | "end" | "count" | "width" | "timezone"
  >;
  series: DetailListeningData["tracks"];
  title: string;
  label: string;
  sortByPeak?: boolean;
  rowWeight?: number;
}) {
  const { ref, width } = usePlotWidth();
  const labelWidth = width < 500 ? 120 : 180;
  const { columns, pitch } = timelineMatrixLayout(
    width,
    labelWidth,
    data.count,
    Math.max(1, Math.min(64, Math.floor(4096 / Math.max(1, series.length)))),
  );
  const date = new Intl.DateTimeFormat(undefined, {
    timeZone: data.timezone,
    year: "numeric",
    month: "short",
    day: "numeric",
    ...(data.end - data.start < 2 * 86400000
      ? { hour: "numeric" as const }
      : {}),
  });
  const axisDate = new Intl.DateTimeFormat(undefined, {
    timeZone: data.timezone,
    ...(data.end - data.start < 2 * 86400000
      ? { hour: "numeric" as const }
      : { month: "short" as const, year: "2-digit" as const }),
  });
  const tickEvery = Math.max(1, Math.ceil(columns / (width < 500 ? 2 : 5)));
  const at = (col: number) =>
    data.start + Math.floor((col * data.count) / columns) * data.width;
  const rows = series.map((track) => ({
    id: track.id,
    label: track.name,
    cells: mergeListeningBins(track.bins, data.count, columns).map(
      (value, col) => ({
        value,
        label: `${track.name} · ${date.format(at(col))} – ${date.format(at(col + 1) - 1)} · ${formatHours(value)}`,
      }),
    ),
  }));
  if (sortByPeak) {
    const peak = (row: (typeof rows)[number]) => {
      const values = row.cells.map((cell) => cell.value);
      return values.indexOf(Math.max(...values));
    };
    rows.sort((a, b) => peak(a) - peak(b) || a.id.localeCompare(b.id));
  }
  return (
    <TitleCard title={title}>
      <div ref={ref} className={s.plot}>
        {rows.length ? (
          <Heatmap
            key={`${data.start}:${data.end}:${series.map((row) => row.id).join(":")}`}
            label={label}
            rows={rows}
            columns={Array.from({ length: columns }, (_, col) =>
              col % tickEvery === 0 ? axisDate.format(at(col)) : "",
            )}
            labelWidth={labelWidth}
            minPitch={pitch}
            maxPitch={pitch}
            maxHeight={520}
            rowWeight={rowWeight}
          />
        ) : (
          <p>No recorded listening history.</p>
        )}
      </div>
    </TitleCard>
  );
}
