import { ToggleButton, ToggleButtonGroup } from "@mui/material";
import { useState } from "react";

import { ArtistDistribution } from "../../services/artistDistribution";
import { formatHours } from "../../services/listeningPatterns";
import { timelineMatrixLayout } from "../../services/matrixLayout";
import TitleCard from "../TitleCard";
import { Heatmap, RequestState, usePlotWidth } from "./shared";

import s from "./index.module.css";

export default function ArtistEras({
  data,
  error,
  retry,
}: {
  data?: ArtistDistribution;
  error?: boolean;
  retry: () => void;
}) {
  const [limit, setLimit] = useState(10);
  const { ref, width } = usePlotWidth();
  const { columns: count, pitch } = timelineMatrixLayout(
    width,
    112,
    data?.count ?? 1,
  );
  const date = new Intl.DateTimeFormat(undefined, {
    timeZone: data?.timezone,
    month: "short",
    day: "numeric",
    year: "numeric",
    ...(data && data.end - data.start < 2 * 86400000
      ? { hour: "numeric" as const }
      : {}),
  });
  const rows = data?.series
    .slice(0, limit)
    .map((artist) => {
      const values = Array<number>(count).fill(0);
      for (const [bin, hours] of artist.bins) {
        // Match the integer source-bin boundaries used by the date labels.
        const col = Math.min(
          count - 1,
          Math.ceil(((bin + 1) * count) / data.count) - 1,
        );
        values[col]! += hours;
      }
      const peak = values.indexOf(Math.max(...values));
      return {
        id: artist.id,
        label: artist.name,
        peak,
        cells: values.map((value, col) => {
          const start =
            data.start + Math.floor((col * data.count) / count) * data.width;
          const end =
            data.start +
            Math.floor(((col + 1) * data.count) / count) * data.width;
          return {
            value,
            label: `${artist.name} · ${date.format(start)} – ${date.format(end - 1)} · ${formatHours(value)}`,
          };
        }),
      };
    })
    .sort((a, b) => a.peak - b.peak || a.id.localeCompare(b.id));
  const tickEvery = Math.max(1, Math.ceil(count / (width < 500 ? 2 : 5)));
  const axisDate = new Intl.DateTimeFormat(undefined, {
    timeZone: data?.timezone,
    ...(data && data.end - data.start < 2 * 86400000
      ? { hour: "numeric" as const }
      : { month: "short" as const, year: "2-digit" as const }),
  });
  return (
    <TitleCard
      title="Artist eras"
      right={
        <ToggleButtonGroup
          size="small"
          exclusive
          value={limit}
          onChange={(_, value: number | null) => {
            if (value !== null) setLimit(value);
          }}
          aria-label="Number of artists">
          <ToggleButton value={10}>10</ToggleButton>
          <ToggleButton value={20}>20</ToggleButton>
        </ToggleButtonGroup>
      }>
      <div ref={ref} className={s.plot}>
        {data ? (
          rows?.length ? (
            <Heatmap
              label="Artist eras"
              rows={rows}
              labelWidth={112}
              minPitch={pitch}
              maxPitch={pitch}
              columns={Array.from({ length: count }, (_, col) =>
                col % tickEvery === 0
                  ? axisDate.format(
                      data.start +
                        Math.floor((col * data.count) / count) * data.width,
                    )
                  : "",
              )}
            />
          ) : (
            <p>No listening history in this period.</p>
          )
        ) : (
          <RequestState error={error} retry={retry} />
        )}
      </div>
    </TitleCard>
  );
}
