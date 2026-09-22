import clsx from "clsx";
import { useState } from "react";
import { useSelector } from "react-redux";
import {
  Area,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { calendarAxis } from "../../services/calendarAxis";
import { ListeningOverview } from "../../services/listeningOverview";
import { selectUser } from "../../services/redux/modules/user/selector";
import { RequestState } from "../ListeningPatterns/shared";
import TitleCard from "../TitleCard";
import { useListeningOverview } from "./context";
import { AverageMarker, VolumeTick } from "./VolumeAxis";

import s from "./index.module.css";

function VolumeDot({
  cx,
  cy,
  payload,
  single,
}: {
  cx?: number;
  cy?: number;
  payload?: { partial: boolean };
  single: boolean;
}) {
  if (cx === undefined || cy === undefined || (!payload?.partial && !single))
    return null;
  return (
    <circle
      cx={cx}
      cy={cy}
      r={3}
      fill="var(--background)"
      stroke="var(--primary)"
      strokeWidth={1.5}
      opacity={payload?.partial ? 0.65 : 1}
    />
  );
}

function VolumePlot({
  data,
  metric,
}: {
  data: ListeningOverview;
  metric: "hours" | "songs";
}) {
  const user = useSelector(selectUser);
  const [width, setWidth] = useState(640);
  const first = data.buckets[0]!;
  const last = data.buckets.at(-1)!;
  const axis = calendarAxis(
    first.start,
    last.start,
    data.unit,
    data.timezone,
    width,
  );
  const singlePadding =
    first.start === last.start ? Math.max(1, first.end - first.start) / 2 : 0;
  const locale =
    user?.settings.dateFormat === "default"
      ? undefined
      : user?.settings.dateFormat;
  const format = (options: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat(locale, { timeZone: data.timezone, ...options });
  const tick = format(axis.format);
  const date = format({
    year: "numeric",
    month: "short",
    day: "numeric",
    ...(data.unit === "hour"
      ? ({ hour: "2-digit", minute: "2-digit", timeZoneName: "short" } as const)
      : {}),
  });
  const useMinutes =
    metric === "hours" &&
    Math.max(
      0,
      data.average?.hours ?? 0,
      ...data.buckets.map((bucket) =>
        Math.max(bucket.hours, bucket.reference?.hours ?? 0),
      ),
    ) < 2;
  const valueLabel = (value: number, compact = false) => {
    const number = metric === "hours" && useMinutes ? value * 60 : value;
    return `${number.toLocaleString(locale, { maximumFractionDigits: 1, ...(compact ? { notation: "compact" } : {}) })}${metric === "hours" ? (useMinutes ? "m" : "h") : compact ? "" : " plays"}`;
  };
  const average = data.comparison === "average";
  const points = data.buckets.map((bucket) => ({
    ...bucket,
    value: bucket[metric],
    comparison: bucket.reference?.[metric] ?? null,
  }));
  return (
    <div
      className={s.plot}
      role="img"
      aria-label={`${metric === "hours" ? "Listening time" : "Songs listened"} by ${data.unit}, starting at zero`}>
      <ResponsiveContainer
        width="100%"
        height="100%"
        onResize={(nextWidth) => setWidth(Math.round(nextWidth))}>
        <ComposedChart
          data={points}
          margin={{ top: 10, right: 8, left: 0, bottom: 0 }}
          accessibilityLayer>
          <XAxis
            dataKey="start"
            type="number"
            scale="time"
            domain={[first.start - singlePadding, last.start + singlePadding]}
            ticks={axis.ticks}
            interval={0}
            tickFormatter={(value: number) => tick.format(value)}
            tick={{ fill: "var(--text-on-light)", fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            padding={{ left: 4, right: 4 }}
          />
          <YAxis
            domain={[0, "auto"]}
            width={48}
            tickFormatter={(value: number) => valueLabel(value, true)}
            allowDecimals={metric === "hours"}
            tick={
              <VolumeTick
                average={data.average?.[metric]}
                format={(value) => valueLabel(value, true)}
              />
            }
            axisLine={false}
            tickLine={false}
          />
          <Tooltip
            cursor={false}
            content={({ active, payload }) => {
              const point = payload?.[0]?.payload as
                | (typeof points)[number]
                | undefined;
              if (!active || !point) return null;
              const fullLabel =
                data.unit === "year"
                  ? format({ year: "numeric" }).format(point.start)
                  : data.unit === "month"
                    ? format({ month: "long", year: "numeric" }).format(
                        point.start,
                      )
                    : data.unit === "week"
                      ? `${date.format(point.start)} – ${date.format(point.end - 1)}`
                      : date.format(point.start);
              return (
                <div className={s.tooltip}>
                  <div>
                    {fullLabel}
                    {point.partial ? ` · partial ${data.unit}` : ""}
                  </div>
                  <strong>{valueLabel(point.value)}</strong>
                  {point.comparison !== null && (
                    <div className={s.referenceValue}>
                      {valueLabel(point.comparison)} ·{" "}
                      {average ? "365-day average" : "previous period"}
                      {point.partial ? " (same portion)" : ""}
                    </div>
                  )}
                  {!average &&
                    point.comparison !== null &&
                    point.referenceStart !== undefined &&
                    point.referenceEnd !== undefined && (
                      <div className={s.referenceValue}>
                        {date.format(point.referenceStart)} –{" "}
                        {date.format(point.referenceEnd - 1)}
                      </div>
                    )}
                </div>
              );
            }}
            wrapperStyle={{ zIndex: 10 }}
          />
          {data.comparison && !data.average && (
            <Line
              dataKey="comparison"
              type="monotoneX"
              stroke="var(--primary)"
              strokeOpacity={0.25}
              strokeWidth={1.5}
              dot={points.length === 1 ? { r: 2 } : false}
              activeDot={false}
              connectNulls={false}
              isAnimationActive={false}
            />
          )}
          <Area
            dataKey="value"
            type="monotoneX"
            baseValue={0}
            stroke="var(--primary)"
            strokeWidth={1.8}
            fill="var(--primary)"
            fillOpacity={0.055}
            dot={<VolumeDot single={points.length === 1} />}
            activeDot={{ r: 4, strokeWidth: 0 }}
            connectNulls={false}
            isAnimationActive={false}
          />
          {data.average && (
            <ReferenceLine
              y={data.average[metric]}
              shape={
                <AverageMarker
                  label={`365-day average: ${valueLabel(data.average[metric])}/day`}
                />
              }
              ifOverflow="extendDomain"
            />
          )}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

export default function ListeningVolume({
  metric,
  className,
}: {
  metric: "hours" | "songs";
  className?: string;
}) {
  const { data, error, retry } = useListeningOverview();
  return (
    <TitleCard
      title={metric === "hours" ? "Time listened" : "Songs listened"}
      className={clsx(s.card, className)}
      contentClassName={s.content}
      right={
        data?.comparison &&
        !data.average && (
          <span className={s.reference}>
            <span className={s.swatch} />
            {data.comparison === "average"
              ? "Typical day"
              : data.comparison === "previousYear"
                ? "Previous year"
                : "Previous 365 days"}
          </span>
        )
      }>
      {!data ? (
        <RequestState error={error} retry={retry} />
      ) : !data.buckets.length ? (
        <p>No listening history in this period.</p>
      ) : (
        <VolumePlot data={data} metric={metric} />
      )}
    </TitleCard>
  );
}
