import {
  Button,
  CircularProgress,
  FormControlLabel,
  MenuItem,
  Select,
  Switch,
} from "@mui/material";
import { useCallback, useState } from "react";
import { useSelector } from "react-redux";

import { api } from "../../../services/apis/api";
import {
  distributionPoints,
  DistributionMode,
  useListeningRequest,
} from "../../../services/listeningTimeline";
import { selectRawIntervalDetail } from "../../../services/redux/modules/user/selector";
import TimelineChart from "../../ListeningTimeline/TimelineChart";
import TitleCard from "../../TitleCard";
import { ImplementedChartProps } from "../types";

import s from "../../ListeningTimeline/index.module.css";

export default function ArtistListeningTimeline({
  className,
}: ImplementedChartProps) {
  const { interval } = useSelector(selectRawIntervalDetail);
  const start = interval.start.getTime();
  const end = interval.end.getTime();
  const request = useCallback(
    () => api.getListeningDistribution(new Date(start), new Date(end)),
    [start, end],
  );
  const { data: result, error, retry } = useListeningRequest(request);
  const [mode, setMode] = useState<DistributionMode>("cumulative");
  const [smooth, setSmooth] = useState(false);
  const [insight, setInsight] = useState("discovery");
  if (!result) {
    return (
      <TitleCard
        title="Artist listening timeline"
        className={className}
        contentClassName={s.section}>
        {error ? (
          <p>
            Could not load your listening history.{" "}
            <Button onClick={retry}>Retry</Button>
          </p>
        ) : (
          <CircularProgress aria-label="Loading listening history" />
        )}
      </TitleCard>
    );
  }
  if (!result.series.length) {
    return (
      <TitleCard title="Artist listening timeline" contentClassName={s.section}>
        <p>No listening history in this period.</p>
      </TitleCard>
    );
  }
  const data = distributionPoints(result, mode, smooth);
  const insights = result.totalHours.map((total, index) => ({
    timestamp: result.start + (index + 1) * result.width,
    series0:
      insight === "discovery"
        ? result.newHours[index]!
        : result.topFiveShare[index] === null
          ? null
          : result.topFiveShare[index]! * 100,
    series1: total - result.newHours[index]!,
  }));
  const total = result.totalHours.reduce((sum, hours) => sum + hours, 0);
  const discovered = result.newHours.reduce((sum, hours) => sum + hours, 0);
  return (
    <div className={s.section}>
      <TitleCard title="Artist listening timeline">
        <div className={s.controls}>
          <Select
            size="small"
            value={mode}
            inputProps={{ "aria-label": "Distribution view" }}
            onChange={(event) =>
              setMode(event.target.value as DistributionMode)
            }>
            <MenuItem value="hours">Listening hours</MenuItem>
            <MenuItem value="share">Share of listening time</MenuItem>
            <MenuItem value="cumulative">Cumulative hours</MenuItem>
          </Select>
          <FormControlLabel
            control={
              <Switch
                checked={smooth}
                onChange={(_, checked) => setSmooth(checked)}
                disabled={mode === "cumulative"}
              />
            }
            label="28-day average"
          />
        </div>
        <p className={s.description}>
          Every artist is shown separately, ordered by listening time. Hover
          over a band to see the artist and their listening time.
          {mode === "cumulative"
            ? " Running totals from the start of the selected period."
            : smooth
              ? " Smoothed over up to 28 days within the selected period; hours are daily averages."
              : " Each point includes all listening in its interval; silent intervals stay at zero."}
        </p>
        <TimelineChart
          bounds={result}
          data={data}
          series={result.series}
          bucketed={mode !== "cumulative" && !smooth}
          stacked
          showLegend={false}
          hoverSeriesOnly
          percent={mode === "share"}
          unit={smooth && mode === "hours" ? "h/day" : "h"}
        />
      </TitleCard>
      <TitleCard title="Discovery & listening habits">
        <div className={s.controls}>
          <Select
            size="small"
            value={insight}
            inputProps={{ "aria-label": "Listening insight" }}
            onChange={(event) => setInsight(event.target.value)}>
            <MenuItem value="discovery">New vs familiar artists</MenuItem>
            <MenuItem value="concentration">Top-five concentration</MenuItem>
          </Select>
        </div>
        <p className={s.description}>
          {insight === "discovery"
            ? `${total ? ((discovered / total) * 100).toFixed(1) : 0}% of listening time went to new artists. An artist is new for 30 days after your first recorded listen, including history before this period.`
            : "The share of each interval's listening time belonging to its five most-played artists, ranked by hours. Higher means more concentrated listening; gaps mean no listening."}
        </p>
        <TimelineChart
          bounds={result}
          data={insights}
          bucketed
          series={
            insight === "discovery"
              ? [
                  { id: "new", name: "New artists" },
                  { id: "familiar", name: "Familiar artists" },
                ]
              : [{ id: "top5", name: "Top five share" }]
          }
          stacked={insight === "discovery"}
          percent={insight === "concentration"}
        />
      </TitleCard>
    </div>
  );
}
