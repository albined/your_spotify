import { useTheme } from "@mui/material";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { DetailListeningRequest } from "../../../components/ListeningPatterns/DetailListening";
import { RequestState } from "../../../components/ListeningPatterns/shared";
import TitleCard from "../../../components/TitleCard";
import { hourlyComparison } from "../../../services/detailListening";

import s from "../../../components/ListeningPatterns/index.module.css";

export default function DayRepartition({
  request,
}: {
  request: DetailListeningRequest;
}) {
  const { data, error, retry } = request;
  const dark = useTheme().palette.mode === "dark";
  const artistColor = dark ? "#65d6a0" : "#147d50";
  return (
    <TitleCard title="Time of day">
      {data?.timeOfDay ? (
        <>
          <div
            className={s.hourChart}
            role="img"
            aria-label="Artist and overall listening by hour, as percentages of listening time">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart
                data={hourlyComparison(data.timeOfDay)}
                margin={{ top: 12, right: 10, bottom: 0, left: 0 }}
                accessibilityLayer>
                <CartesianGrid
                  vertical={false}
                  stroke="currentColor"
                  strokeOpacity={0.1}
                />
                <XAxis
                  dataKey="hour"
                  interval={2}
                  tick={{ fill: "currentColor", fontSize: 11 }}
                />
                <YAxis
                  width={40}
                  tickFormatter={(value) => `${value}%`}
                  tick={{ fill: "currentColor", fontSize: 11 }}
                />
                <Tooltip
                  labelFormatter={(hour) =>
                    `${hour}:00–${String(Number(hour) + 1).padStart(2, "0")}:00`
                  }
                  formatter={(value, name) => [
                    `${Number(value).toLocaleString(undefined, { maximumFractionDigits: 1 })}%`,
                    name,
                  ]}
                  contentStyle={{
                    background: "var(--background)",
                    color: "var(--text-on-light)",
                    borderRadius: 6,
                  }}
                  itemStyle={{ color: "var(--text-on-light)" }}
                  wrapperStyle={{ zIndex: 4 }}
                />
                <Bar
                  dataKey="artist"
                  name="This artist"
                  fill={artistColor}
                  radius={[3, 3, 0, 0]}
                  isAnimationActive={false}
                />
                <Line
                  dataKey="overall"
                  name="All listening"
                  stroke="var(--text-on-light)"
                  strokeOpacity={0.65}
                  strokeWidth={2}
                  strokeDasharray="4 3"
                  dot={false}
                  isAnimationActive={false}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <div className={s.hourLegend}>
            <span>
              <i style={{ background: artistColor }} />
              This artist
            </span>
            <span>
              <i className={s.overallMark} />
              All listening
            </span>
          </div>
        </>
      ) : data === null ? (
        <p>No recorded listening history.</p>
      ) : (
        <RequestState error={error} retry={retry} />
      )}
    </TitleCard>
  );
}
