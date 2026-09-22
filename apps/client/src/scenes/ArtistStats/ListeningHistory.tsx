import { MenuItem, Select } from "@mui/material";
import { useCallback, useState } from "react";

import { RequestState } from "../../components/ListeningPatterns/shared";
import TimelineChart, {
  useTimelineDate,
} from "../../components/ListeningTimeline/TimelineChart";
import TitleCard from "../../components/TitleCard";
import { api } from "../../services/apis/api";
import {
  ArtistTimeline,
  cumulativeTimelinePoints,
  useListeningRequest,
} from "../../services/listeningTimeline";

import s from "../../components/ListeningTimeline/index.module.css";

function ListeningHistoryCharts({ result }: { result: ArtistTimeline }) {
  const [comparison, setComparison] = useState<"albums" | "songs">("albums");
  const date = useTimelineDate(result);
  const series = result[comparison];
  return (
    <div className={s.section}>
      <TitleCard
        title="Favourites over time"
        right={
          <Select
            size="small"
            value={comparison}
            inputProps={{ "aria-label": "Compare albums or songs" }}
            onChange={(event) =>
              setComparison(event.target.value as "albums" | "songs")
            }>
            <MenuItem value="albums">Top 5 albums</MenuItem>
            <MenuItem value="songs">Top 5 songs</MenuItem>
          </Select>
        }>
        <TimelineChart
          bounds={result}
          data={cumulativeTimelinePoints(
            result,
            series.map((item) => item.hours),
          )}
          series={series}
          legendPosition="right"
          height={300}
        />
      </TitleCard>
      {!!result.milestones.length && (
        <TitleCard title="Listening milestones">
          <ul className={s.events}>
            {result.milestones.map((milestone) => (
              <li key={milestone.hours}>
                <strong>{milestone.hours.toLocaleString()} hours</strong>
                <br />
                {date.full(milestone.date)}
              </li>
            ))}
          </ul>
        </TitleCard>
      )}
    </div>
  );
}

export default function ListeningHistory({ artistId }: { artistId: string }) {
  const request = useCallback(
    () => api.getArtistTimeline(artistId),
    [artistId],
  );
  const { data, error, retry } = useListeningRequest(request);
  if (data === undefined)
    return (
      <TitleCard title="Favourites over time">
        <RequestState error={error} retry={retry} />
      </TitleCard>
    );
  if (!data) return null;
  return <ListeningHistoryCharts key={artistId} result={data} />;
}
