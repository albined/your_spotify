import { Button, CircularProgress } from "@mui/material";
import { useCallback } from "react";
import { useSelector } from "react-redux";

import { api } from "../../services/apis/api";
import {
  cumulativeTimelinePoints,
  TopTimelineKind,
  useListeningRequest,
} from "../../services/listeningTimeline";
import { selectRawIntervalDetail } from "../../services/redux/modules/user/selector";
import TitleCard from "../TitleCard";
import TimelineChart from "./TimelineChart";

import s from "./index.module.css";

export default function TopListeningRace({ kind }: { kind: TopTimelineKind }) {
  const { interval } = useSelector(selectRawIntervalDetail);
  const start = interval.start.getTime();
  const end = interval.end.getTime();
  const request = useCallback(
    () => api.getTopTimeline(kind, new Date(start), new Date(end)),
    [kind, start, end],
  );
  const { data, error, retry } = useListeningRequest(request);
  return (
    <div className={s.race}>
      <TitleCard
        title={`The race for your top ${kind}`}
        contentClassName={s.section}>
        {!data ? (
          error ? (
            <p>
              Could not load the chart. <Button onClick={retry}>Retry</Button>
            </p>
          ) : (
            <CircularProgress aria-label="Loading top listening timeline" />
          )
        ) : !data.series.length ? (
          <p>No listening history in this period.</p>
        ) : (
          <>
            <p className={s.description}>
              Your top ten {kind} by listening time in the selected period,
              starting together at zero. Hover, focus, or tap a name or cover to
              follow its line.
            </p>
            <TimelineChart
              height={360}
              bounds={data}
              data={cumulativeTimelinePoints(
                data,
                data.series.map((item) => item.hours),
              )}
              series={data.series.map((item, index) => ({
                ...item,
                name: `#${index + 1} ${item.name}`,
                value: `${(item.hours.at(-1) ?? 0).toLocaleString(undefined, { maximumFractionDigits: 1 })} h`,
              }))}
            />
          </>
        )}
      </TitleCard>
    </div>
  );
}
