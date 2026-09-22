import { ToggleButton, ToggleButtonGroup } from "@mui/material";
import { useCallback, useState } from "react";
import { useSelector } from "react-redux";

import { api } from "../../services/apis/api";
import { formatHours } from "../../services/listeningPatterns";
import { useListeningRequest } from "../../services/listeningTimeline";
import { timelineMatrixLayout } from "../../services/matrixLayout";
import { selectRawIntervalDetail } from "../../services/redux/modules/user/selector";
import TitleCard from "../TitleCard";
import { Heatmap, RequestState, usePlotWidth } from "./shared";

import s from "./index.module.css";

export default function ArtistEras() {
  const [limit, setLimit] = useState<10 | 20>(10);
  const { interval } = useSelector(selectRawIntervalDetail);
  const start = interval.start.getTime();
  const end = interval.end.getTime();
  const request = useCallback(
    () => api.getArtistEras(new Date(start), new Date(end)),
    [start, end],
  );
  const { data, error, retry } = useListeningRequest(request);
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
    .filter((artist) => data.selections[limit].includes(artist.id))
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
          const cellStart =
            data.start + Math.floor((col * data.count) / count) * data.width;
          const cellEnd =
            data.start +
            Math.floor(((col + 1) * data.count) / count) * data.width;
          return {
            value,
            label: `${artist.name} · ${date.format(cellStart)} – ${date.format(cellEnd - 1)} · ${formatHours(value)}`,
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
          onChange={(_, value: 10 | 20 | null) => {
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
              key={`${start}:${end}:${limit}`}
              label="Artist eras"
              rows={rows}
              labelWidth={112}
              minPitch={pitch}
              maxPitch={pitch}
              rowWeight={0.8}
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
