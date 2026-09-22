import { useCallback } from "react";
import { useSelector } from "react-redux";

import { api } from "../../services/apis/api";
import {
  calendarGrid,
  formatHours,
  weekdays,
} from "../../services/listeningPatterns";
import { useListeningRequest } from "../../services/listeningTimeline";
import { selectRawIntervalDetail } from "../../services/redux/modules/user/selector";
import TitleCard from "../TitleCard";
import { Heatmap, RequestState } from "./shared";

import s from "./index.module.css";

export default function ListeningHeatmaps() {
  const { interval } = useSelector(selectRawIntervalDetail);
  const start = interval.start.getTime();
  const end = interval.end.getTime();
  const request = useCallback(
    () => api.getListeningHeatmaps(new Date(start), new Date(end)),
    [start, end],
  );
  const { data, error, retry } = useListeningRequest(request);
  const calendar = data ? calendarGrid(data) : undefined;
  const rhythmValues = new Map(
    data?.rhythms.map((cell) => [`${cell.weekday}:${cell.hour}`, cell.hours]),
  );
  const rhythms = weekdays.map((label, index) => ({
    id: label,
    label,
    cells: Array.from({ length: 24 }, (_, hour) => {
      const value = rhythmValues.get(`${index + 1}:${hour}`) ?? 0;
      return {
        value,
        label: `${label} ${String(hour).padStart(2, "0")}:00–${String(hour + 1).padStart(2, "0")}:00 · ${formatHours(value)}`,
      };
    }),
  }));
  const status = data ? (
    <p>No listening history in this period.</p>
  ) : (
    <RequestState error={error} retry={retry} />
  );
  return (
    <div className={s.cards}>
      <TitleCard title="Listening calendar">
        {data?.days.length && calendar ? (
          <Heatmap
            key={`${start}:${end}`}
            label="Listening calendar"
            {...calendar}
          />
        ) : (
          status
        )}
      </TitleCard>
      <TitleCard title="Daily rhythms">
        {data?.days.length ? (
          <Heatmap
            key={`${start}:${end}`}
            label="Daily rhythms"
            rows={rhythms}
            centerColumnLabels
            columns={Array.from({ length: 24 }, (_, hour) =>
              String(hour).padStart(2, "0"),
            )}
          />
        ) : (
          status
        )}
      </TitleCard>
    </div>
  );
}
