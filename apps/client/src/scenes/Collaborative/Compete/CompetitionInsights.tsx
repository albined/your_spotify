import { useCallback } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { RequestState } from "../../../components/ListeningPatterns/shared";
import TimelineChart, {
  seriesColor,
} from "../../../components/ListeningTimeline/TimelineChart";
import TitleCard from "../../../components/TitleCard";
import { api } from "../../../services/apis/api";
import {
  cumulativeTimelinePoints,
  useListeningRequest,
} from "../../../services/listeningTimeline";

import s from "./index.module.css";

export default function CompetitionInsights({
  userIds,
  start,
  end,
}: {
  userIds: string[];
  start: number;
  end: number;
}) {
  const request = useCallback(
    () =>
      userIds.length
        ? api.getCompetitionInsights(userIds, new Date(start), new Date(end))
        : Promise.resolve({ data: null }),
    [userIds, start, end],
  );
  const { data, error, retry } = useListeningRequest(request);
  const status = !userIds.length ? (
    <p>Select at least one person to start comparing.</p>
  ) : !data ? (
    <RequestState error={error} retry={retry} />
  ) : null;
  const diversityStatus =
    status ??
    (data?.series.some((person) =>
      person.values.some((value) => value > 0),
    ) ? null : (
      <p>No listening in these 30-day windows.</p>
    ));
  const hoursStatus =
    status ??
    (data?.series.some((person) =>
      person.hours.some((hours) => hours > 0),
    ) ? null : (
      <p>No listening history in this period.</p>
    ));
  const hourly = Array.from({ length: 24 }, (_, hour) => ({
    hour: String(hour).padStart(2, "0"),
    ...Object.fromEntries(
      data?.series.map((person, i) => [
        `person${i}`,
        person.percentages[hour],
      ]) ?? [],
    ),
  }));
  return (
    <div className={s.insights}>
      <TitleCard
        title="Artist diversity · 30 days"
        contentClassName={s.chartContent}>
        {diversityStatus ??
          (data && (
            <TimelineChart
              bounds={data}
              data={cumulativeTimelinePoints(
                data,
                data.series.map((person) => person.values),
              )}
              series={data.series}
              unit="effective artists"
              height={280}
            />
          ))}
      </TitleCard>
      <TitleCard title="Time of day" contentClassName={s.chartContent}>
        {hoursStatus ??
          (data && (
            <div className={s.hourScroll}>
              <div
                className={s.hourChart}
                style={{
                  minWidth: Math.max(300, 24 * data.series.length * 5 + 48),
                }}
                role="img"
                aria-label="Listening by local hour, as a percentage for each person">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={hourly}
                    margin={{ top: 12, right: 8, left: 0, bottom: 0 }}
                    accessibilityLayer>
                    <CartesianGrid
                      vertical={false}
                      stroke="currentColor"
                      strokeOpacity={0.1}
                    />
                    <XAxis
                      dataKey="hour"
                      interval={1}
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
                      wrapperStyle={{ zIndex: 4 }}
                    />
                    <Legend
                      iconType="circle"
                      iconSize={9}
                      wrapperStyle={{ fontSize: 12 }}
                    />
                    {data.series.map((person, i) => (
                      <Bar
                        key={person.id}
                        name={person.name}
                        dataKey={`person${i}`}
                        fill={seriesColor(i)}
                        radius={[2, 2, 0, 0]}
                        isAnimationActive={false}
                      />
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          ))}
      </TitleCard>
    </div>
  );
}
