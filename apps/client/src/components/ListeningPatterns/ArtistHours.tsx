import { ToggleButton, ToggleButtonGroup } from "@mui/material";
import { useCallback, useState } from "react";
import { useSelector } from "react-redux";

import { api } from "../../services/apis/api";
import { formatHours } from "../../services/listeningPatterns";
import { useListeningRequest } from "../../services/listeningTimeline";
import { selectRawIntervalDetail } from "../../services/redux/modules/user/selector";
import TitleCard from "../TitleCard";
import { Heatmap, RequestState } from "./shared";

import s from "./index.module.css";

const hourLabel = (hour: number) => `${String(hour).padStart(2, "0")}:00`;

export default function ArtistHours() {
  const [limit, setLimit] = useState<10 | 20>(10);
  const { interval } = useSelector(selectRawIntervalDetail);
  const start = interval.start.getTime();
  const end = interval.end.getTime();
  const request = useCallback(
    () => api.getArtistHours(new Date(start), new Date(end)),
    [start, end],
  );
  const { data, error, retry } = useListeningRequest(request);
  const rows = data?.series
    .slice(0, limit)
    .map((artist) => ({
      id: artist.id,
      label: artist.name,
      cells: artist.hours.map((value, hour) => ({
        value,
        label: `${artist.name} · ${hourLabel(hour)}–${hourLabel((hour + 1) % 24)} · ${formatHours(value)} · ${data.timezone}`,
      })),
    }));
  return (
    <TitleCard
      title="Artists by hour"
      right={
        <ToggleButtonGroup
          size="small"
          exclusive
          value={limit}
          aria-label="Number of hourly artists"
          onChange={(_, value: 10 | 20 | null) => {
            if (value !== null) setLimit(value);
          }}>
          <ToggleButton value={10}>10</ToggleButton>
          <ToggleButton value={20}>20</ToggleButton>
        </ToggleButtonGroup>
      }>
      <p>
        Top artists by total listening time. Stronger color means more listening
        hours; times use {data?.timezone ?? "your configured timezone"}.
      </p>
      <div className={s.plot}>
        {!data ? (
          <RequestState error={error} retry={retry} />
        ) : !rows?.length ? (
          <p>No listening history in this period.</p>
        ) : (
          <Heatmap
            key={`${start}:${end}:${limit}`}
            label="Artists by hour"
            rows={rows}
            labelWidth={112}
            columns={Array.from({ length: 24 }, (_, hour) =>
              hour % 3 === 0 ? hourLabel(hour) : "",
            )}
          />
        )}
      </div>
    </TitleCard>
  );
}
