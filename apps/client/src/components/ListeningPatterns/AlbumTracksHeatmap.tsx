import {
  DetailListeningData,
  mergeListeningBins,
} from "../../services/detailListening";
import { formatHours } from "../../services/listeningPatterns";
import { timelineMatrixLayout } from "../../services/matrixLayout";
import TitleCard from "../TitleCard";
import { Heatmap, usePlotWidth } from "./shared";

import s from "./index.module.css";

export default function AlbumTracksHeatmap({
  data,
}: {
  data: DetailListeningData;
}) {
  const { ref, width } = usePlotWidth();
  const labelWidth = width < 500 ? 120 : 180;
  const { columns, pitch } = timelineMatrixLayout(
    width,
    labelWidth,
    data.count,
    Math.max(
      1,
      Math.min(64, Math.floor(4096 / Math.max(1, data.tracks.length))),
    ),
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
  const rows = data.tracks.map((track) => ({
    id: track.id,
    label: track.name,
    cells: mergeListeningBins(track.bins, data.count, columns).map(
      (value, col) => ({
        value,
        label: `${track.name} · ${date.format(at(col))} – ${date.format(at(col + 1) - 1)} · ${formatHours(value)}`,
      }),
    ),
  }));
  return (
    <TitleCard title="Songs over time">
      <div ref={ref} className={s.plot}>
        {rows.length ? (
          <Heatmap
            label="Album songs over time"
            rows={rows}
            columns={Array.from({ length: columns }, (_, col) =>
              col % tickEvery === 0 ? axisDate.format(at(col)) : "",
            )}
            labelWidth={labelWidth}
            minPitch={pitch}
            maxPitch={pitch}
            maxHeight={520}
          />
        ) : (
          <p>No recorded songs for this album.</p>
        )}
      </div>
    </TitleCard>
  );
}
