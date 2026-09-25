import { MenuItem, Select } from "@mui/material";
import clsx from "clsx";
import { useCallback, useState } from "react";
import {
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { api } from "../../services/apis/api";
import { useListeningRequest } from "../../services/listeningTimeline";
import { RequestState } from "../ListeningPatterns/shared";
import { useTimelineDate } from "../ListeningTimeline/TimelineChart";
import TitleCard from "../TitleCard";
import { useOverviewSelection } from "./context";

import s from "./index.module.css";

export default function ArtistDiversity({ className }: { className?: string }) {
  const [windowDays, setWindowDays] = useState<number | "auto">("auto");
  const { start, end, period, user } = useOverviewSelection();
  const request = useCallback(async () => {
    if (!user) throw new Error("No account selected");
    return api.getPersonalArtistDiversity(
      new Date(start),
      new Date(end),
      period,
      windowDays === "auto" ? undefined : windowDays,
    );
  }, [start, end, period, user, windowDays]);
  const { data, error, retry } = useListeningRequest(request);
  const date = useTimelineDate(data ?? { start, end, width: 0, count: 0 });
  const points = data?.values.map((value, index) => ({
    timestamp: Math.min(data.end, data.start + index * data.width),
    value,
  }));
  const formatValue = (value: number) =>
    value.toLocaleString(undefined, { maximumFractionDigits: 1 });
  return (
    <TitleCard
      title={`Artist diversity${data ? ` · ${data.windowDays} days` : ""}`}
      right={
        <Select
          size="small"
          value={windowDays}
          inputProps={{ "aria-label": "Diversity window" }}
          onChange={(event) =>
            setWindowDays(
              event.target.value === "auto"
                ? "auto"
                : Number(event.target.value),
            )
          }>
          <MenuItem value="auto">Auto window</MenuItem>
          {[7, 30, 90, 180, 365].map((days) => (
            <MenuItem key={days} value={days}>
              {days} days
            </MenuItem>
          ))}
        </Select>
      }
      info="Effective number of artists, weighted by listening time in the trailing window. Auto uses 7 days for ranges up to 90 days, 30 for up to a year, 90 for up to 3 years, 180 for up to 6 years, and 365 beyond that."
      className={clsx(s.card, className)}
      contentClassName={s.content}>
      {!data ? (
        <RequestState error={error} retry={retry} />
      ) : !data.values.some((value) => value !== null) ? (
        <p>No listening in these {data.windowDays}-day windows.</p>
      ) : (
        <div
          className={s.plot}
          role="img"
          aria-label={`Effective artists over trailing ${data.windowDays}-day windows`}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart
              data={points}
              margin={{ top: 10, right: 12, left: 0, bottom: 0 }}
              accessibilityLayer>
              <XAxis
                dataKey="timestamp"
                type="number"
                scale="time"
                domain={[data.start, data.end]}
                tickFormatter={date.tick}
                axisLine={false}
                tickLine={false}
                minTickGap={30}
                tick={{ fill: "var(--text-on-light)", fontSize: 11 }}
              />
              <YAxis
                domain={[0, "auto"]}
                width={42}
                tickFormatter={formatValue}
                axisLine={false}
                tickLine={false}
                tick={{ fill: "var(--text-on-light)", fontSize: 11 }}
              />
              <Tooltip
                labelFormatter={(value) => date.full(Number(value))}
                formatter={(value) => [
                  `${formatValue(Number(value))} effective artists`,
                  "",
                ]}
                contentStyle={{
                  background: "var(--background)",
                  color: "var(--text-on-light)",
                  border: "var(--content-border)",
                  borderRadius: 6,
                }}
                wrapperStyle={{ zIndex: 10 }}
              />
              <Line
                dataKey="value"
                type="linear"
                stroke="var(--primary)"
                strokeWidth={2}
                dot={false}
                connectNulls={false}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </TitleCard>
  );
}
