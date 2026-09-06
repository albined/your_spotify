import { Button, CircularProgress, MenuItem, Select } from "@mui/material";
import { useCallback, useState } from "react";

import TimelineChart, {
  useTimelineDate,
} from "../../components/ListeningTimeline/TimelineChart";
import TitleCard from "../../components/TitleCard";
import { api } from "../../services/apis/api";
import {
  ArtistTimeline,
  useListeningRequest,
} from "../../services/listeningTimeline";

import s from "../../components/ListeningTimeline/index.module.css";

function ListeningHistoryCharts({ result }: { result: ArtistTimeline }) {
  const [comparison, setComparison] = useState<"albums" | "songs">("albums");
  const date = useTimelineDate(result);
  const series = result[comparison];
  const total = result.total.map((hours, index) => ({
    timestamp: Math.min(result.end, result.start + index * result.width),
    series0: hours,
  }));
  const compared = result.total.map((_, index) => {
    const point: Record<string, number> = {
      timestamp: Math.min(result.end, result.start + index * result.width),
    };
    series.forEach((item, seriesIndex) => {
      point[`series${seriesIndex}`] = item.hours[index]!;
    });
    return point;
  });
  return (
    <div className={s.section}>
      <TitleCard title="Your history with this artist">
        <p className={s.description}>
          {(result.total.at(-1) ?? 0).toLocaleString(undefined, {
            maximumFractionDigits: 1,
          })}{" "}
          hours since {date.full(result.start)}. Cumulative listening time
          through today. Steep climbs mark heavy listening; flat stretches mark
          breaks. Based on recorded listens, credited to the track's primary
          artist.
        </p>
        <TimelineChart
          bounds={result}
          data={total}
          series={[{ id: "total", name: "Total listening time" }]}
        />
      </TitleCard>
      <TitleCard title="Favourites over time">
        <div className={s.controls}>
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
        </div>
        <p className={s.description}>
          Cumulative hours for your lifetime top five {comparison}, ranked by
          listening time. Hover, focus, or tap a cover below to highlight its
          line.
        </p>
        <TimelineChart bounds={result} data={compared} series={series} />
      </TitleCard>
      <div className={s.cards}>
        <TitleCard title="Obsession periods">
          <p className={s.description}>
            Your busiest rolling 7- and 30-day stretches with this artist.
          </p>
          <ul className={s.events}>
            {result.peaks.map((peak) => (
              <li key={peak.days}>
                <strong>
                  {peak.hours.toFixed(1)} hours in {peak.days} days
                </strong>
                <br />
                {date.full(peak.start)} – {date.full(peak.end)}
              </li>
            ))}
          </ul>
        </TitleCard>
        <TitleCard title="Rediscoveries">
          <p className={s.description}>
            Your latest returns after at least 90 days without a recorded
            listen.
          </p>
          {result.rediscoveries.length ? (
            <ul className={s.events}>
              {result.rediscoveries.map((event) => (
                <li key={event.date}>
                  <strong>{date.full(event.date)}</strong>
                  <br />
                  After {event.gapDays} days away
                </li>
              ))}
            </ul>
          ) : (
            <p>No gaps of 90 days yet.</p>
          )}
        </TitleCard>
        <TitleCard title="Listening milestones">
          <p className={s.description}>
            When you crossed 10, 50, 100, 250, 500, and 1,000 recorded hours.
          </p>
          {result.milestones.length ? (
            <ul className={s.events}>
              {result.milestones.map((milestone) => (
                <li key={milestone.hours}>
                  <strong>{milestone.hours.toLocaleString()} hours</strong>
                  <br />
                  {date.full(milestone.date)}
                </li>
              ))}
            </ul>
          ) : (
            <p>Your first milestone is 10 hours.</p>
          )}
        </TitleCard>
      </div>
    </div>
  );
}

export default function ListeningHistory({ artistId }: { artistId: string }) {
  const request = useCallback(
    () => api.getArtistTimeline(artistId),
    [artistId],
  );
  const { data, error, retry } = useListeningRequest(request);
  if (data === undefined) {
    return (
      <TitleCard title="Your listening history" contentClassName={s.section}>
        {error ? (
          <p>
            Could not load your listening history.{" "}
            <Button onClick={retry}>Retry</Button>
          </p>
        ) : (
          <CircularProgress aria-label="Loading artist listening history" />
        )}
      </TitleCard>
    );
  }
  if (!data)
    return (
      <TitleCard title="Your listening history" contentClassName={s.section}>
        <p>No recorded listens for this artist yet.</p>
      </TitleCard>
    );
  return <ListeningHistoryCharts result={data} />;
}
