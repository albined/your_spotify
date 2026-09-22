import { useCallback, useMemo } from "react";

import { api } from "../../services/apis/api";
import {
  listeningRate,
  ListeningItemKind,
} from "../../services/detailListening";
import { calendarGrid } from "../../services/listeningPatterns";
import { useListeningRequest } from "../../services/listeningTimeline";
import TimelineChart from "../ListeningTimeline/TimelineChart";
import TitleCard from "../TitleCard";
import AlbumTracksHeatmap from "./AlbumTracksHeatmap";
import { Heatmap, RequestState } from "./shared";

import s from "./index.module.css";

export function useDetailListening(kind: ListeningItemKind, id: string) {
  const request = useCallback(
    () => api.getDetailListening(kind, id),
    [kind, id],
  );
  return useListeningRequest(request);
}

export type DetailListeningRequest = ReturnType<typeof useDetailListening>;

export function DetailListeningCharts({
  kind,
  request,
}: {
  kind: ListeningItemKind;
  request: DetailListeningRequest;
}) {
  const { data, error, retry } = request;
  const rate = useMemo(
    () => (data && kind === "artist" ? listeningRate(data) : []),
    [data, kind],
  );
  if (!data)
    return (
      <TitleCard title="Listening calendar">
        {data === null ? (
          <p>No recorded listening history.</p>
        ) : (
          <RequestState error={error} retry={retry} />
        )}
      </TitleCard>
    );
  return (
    <div className={s.cards}>
      {kind === "artist" && (
        <TitleCard title="Your history with this artist">
          <TimelineChart
            bounds={data}
            data={rate}
            series={[{ id: "activity", name: "Listening time" }]}
            unit="h/day"
            showLegend={false}
            height={300}
          />
        </TitleCard>
      )}
      <TitleCard title="Listening calendar">
        <Heatmap
          key={`${data.start}:${data.end}`}
          label="Listening calendar"
          {...calendarGrid(data)}
        />
      </TitleCard>
      {kind === "album" && <AlbumTracksHeatmap data={data} />}
    </div>
  );
}

export default function DetailListening({
  kind,
  id,
}: {
  kind: ListeningItemKind;
  id: string;
}) {
  const request = useDetailListening(kind, id);
  return <DetailListeningCharts kind={kind} request={request} />;
}
