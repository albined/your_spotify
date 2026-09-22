import clsx from "clsx";
import { useSelector } from "react-redux";
import {
  Bar,
  Cell,
  ComposedChart,
  Line,
  Rectangle,
  RectangleProps,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { ListeningOverview } from "../../services/listeningOverview";
import { selectUser } from "../../services/redux/modules/user/selector";
import { RequestState } from "../ListeningPatterns/shared";
import TitleCard from "../TitleCard";
import { useListeningOverview } from "./context";

import s from "./index.module.css";

function VolumePlot({
  data,
  metric,
}: {
  data: ListeningOverview;
  metric: "hours" | "songs";
}) {
  const user = useSelector(selectUser);
  const locale =
    user?.settings.dateFormat === "default"
      ? undefined
      : user?.settings.dateFormat;
  const format = (options: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat(locale, { timeZone: data.timezone, ...options });
  const tick = format(
    data.unit === "hour"
      ? { hour: "2-digit", hourCycle: "h23" }
      : data.unit === "year"
        ? { year: "numeric" }
        : data.unit === "month"
          ? {
              month: "short",
              ...(data.end - data.start > 366 * 86400000
                ? ({ year: "2-digit" } as const)
                : {}),
            }
          : { month: "short", day: "numeric" },
  );
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
    extent: Math.max(bucket[metric], bucket.reference?.[metric] ?? 0),
  }));
  return (
    <div
      className={s.plot}
      role="img"
      aria-label={`${metric === "hours" ? "Listening time" : "Songs listened"} by ${data.unit}, starting at zero`}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart
          data={points}
          margin={{ top: 10, right: 8, left: 0, bottom: 0 }}
          barCategoryGap="25%"
          accessibilityLayer>
          <XAxis
            dataKey="start"
            tickFormatter={(value: number) => tick.format(value)}
            tick={{ fill: "var(--text-on-light)", fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            minTickGap={22}
          />
          <YAxis
            domain={[0, "auto"]}
            width={48}
            tickFormatter={(value: number) => valueLabel(value, true)}
            allowDecimals={metric === "hours"}
            tick={{ fill: "var(--text-on-light)", fontSize: 11 }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip
            cursor={{ fill: "var(--text-on-light)", fillOpacity: 0.04 }}
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
          <Bar
            dataKey={data.comparison && !average ? "extent" : "value"}
            fill="var(--primary)"
            radius={[3, 3, 0, 0]}
            maxBarSize={52}
            shape={
              data.comparison && !average
                ? (raw: unknown) => {
                    const {
                      x = 0,
                      y = 0,
                      width = 0,
                      height = 0,
                      payload,
                    } = raw as RectangleProps & {
                      payload: (typeof points)[number];
                    };
                    const previousHeight = payload.extent
                      ? (height * (payload.comparison ?? 0)) / payload.extent
                      : 0;
                    const currentHeight = payload.extent
                      ? (height * payload.value) / payload.extent
                      : 0;
                    // One slot for both bars keeps their centers identical at
                    // every width. The wider reference remains visible even
                    // when the current value is greater.
                    return (
                      <g>
                        <Rectangle
                          x={x}
                          y={y + height - previousHeight}
                          width={width}
                          height={previousHeight}
                          fill="var(--primary)"
                          fillOpacity={0.18}
                          radius={[3, 3, 0, 0]}
                        />
                        <Rectangle
                          x={x + width * 0.18}
                          y={y + height - currentHeight}
                          width={width * 0.64}
                          height={currentHeight}
                          fill="var(--primary)"
                          fillOpacity={payload.partial ? 0.5 : 0.9}
                          radius={[3, 3, 0, 0]}
                        />
                      </g>
                    );
                  }
                : undefined
            }
            isAnimationActive={false}>
            {points.map((point) => (
              <Cell key={point.start} fillOpacity={point.partial ? 0.5 : 0.9} />
            ))}
          </Bar>
          {data.average && (
            <ReferenceLine
              y={data.average[metric]}
              stroke="var(--text-on-light)"
              strokeOpacity={0.6}
              strokeWidth={1.5}
              strokeDasharray="4 4"
              ifOverflow="extendDomain"
            />
          )}
          {average && !data.average && points.length === 1 && (
            <ReferenceLine
              y={points[0]!.comparison ?? 0}
              stroke="var(--text-on-light)"
              strokeOpacity={0.6}
              strokeDasharray="4 4"
              ifOverflow="extendDomain"
            />
          )}
          {average && !data.average && points.length > 1 && (
            <Line
              dataKey="comparison"
              type="linear"
              stroke="var(--text-on-light)"
              strokeOpacity={0.6}
              strokeWidth={1.5}
              strokeDasharray="4 4"
              dot={false}
              activeDot={false}
              connectNulls={false}
              isAnimationActive={false}
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
        data?.comparison && (
          <span className={s.reference}>
            <span
              className={data.comparison === "average" ? s.dash : s.swatch}
            />
            {data.comparison === "average"
              ? "365-day average"
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
