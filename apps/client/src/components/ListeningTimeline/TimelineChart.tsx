import { useState } from "react";
import { useSelector } from "react-redux";
import {
  Area,
  AreaChart,
  ComposedChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { getColor } from "../../services/colors";
import {
  ListeningSeries,
  TimelineBounds,
} from "../../services/listeningTimeline";
import { selectUser } from "../../services/redux/modules/user/selector";
import IdealImage from "../IdealImage";

import s from "./index.module.css";

const seriesColor = (index: number) =>
  index < 10
    ? getColor([2, 10, 16, 4, 3, 5, 17, 26, 12, 24][index]!)
    : `hsl(${(index * 137.508) % 360} 65% ${index % 2 ? 62 : 48}%)`;

export function useTimelineDate(bounds: TimelineBounds) {
  const user = useSelector(selectUser);
  const locale =
    user?.settings.dateFormat === "default"
      ? undefined
      : user?.settings.dateFormat;
  const timeZone = bounds.timezone ?? undefined;
  const span = bounds.end - bounds.start;
  const tick = new Intl.DateTimeFormat(locale, {
    timeZone,
    ...(span < 2 * 86_400_000
      ? ({ hour: "2-digit", minute: "2-digit" } as const)
      : span < 365 * 86_400_000
        ? ({ month: "short", day: "numeric" } as const)
        : ({ month: "short", year: "numeric" } as const)),
  });
  const full = new Intl.DateTimeFormat(locale, {
    timeZone,
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
  return {
    tick: (value: number) => tick.format(new Date(value)),
    full: (value: number | string) => full.format(new Date(value)),
  };
}

export interface ChartSeries extends Pick<ListeningSeries, "id" | "name"> {
  images?: ListeningSeries["images"];
  subtitle?: string;
  value?: string;
  lineOnly?: boolean;
}

interface Props {
  bounds: TimelineBounds;
  data: Record<string, number | null>[];
  series: ChartSeries[];
  stacked?: boolean;
  percent?: boolean;
  unit?: string;
  bucketed?: boolean;
  height?: number;
  showLegend?: boolean;
  hoverSeriesOnly?: boolean;
}

export default function TimelineChart({
  bounds,
  data,
  series,
  stacked = false,
  percent = false,
  unit = "h",
  bucketed = false,
  height = 280,
  showLegend = true,
  hoverSeriesOnly = false,
}: Props) {
  const [hovered, setHovered] = useState<string | null>(null);
  const [pinned, setPinned] = useState<string | null>(null);
  const candidate = hovered ?? pinned;
  const highlighted = series.some((item) => item.id === candidate)
    ? candidate
    : null;
  const date = useTimelineDate(bounds);
  const Chart = stacked
    ? series.some((item) => item.lineOnly)
      ? ComposedChart
      : AreaChart
    : LineChart;
  return (
    <>
      <div
        className={s.chart}
        style={{ height }}
        role="img"
        aria-label={`Listening timeline: ${series.map((item) => item.name).join(", ")}. Values in ${percent ? "percent" : unit}.`}>
        <ResponsiveContainer width="100%" height="100%">
          <Chart
            data={data}
            margin={{ top: 12, right: 16, bottom: 0, left: 0 }}
            accessibilityLayer>
            <CartesianGrid
              strokeDasharray="3 3"
              vertical={false}
              stroke="#888"
              strokeOpacity={0.2}
            />
            <XAxis
              dataKey="timestamp"
              type="number"
              scale="time"
              domain={[bounds.start, bounds.end]}
              tickFormatter={date.tick}
              tick={{ fill: "var(--text-on-light)" }}
              minTickGap={35}
            />
            <YAxis
              width={65}
              allowDecimals={percent || unit === "h" || unit === "h/day"}
              tick={{ fill: "var(--text-on-light)" }}
              domain={percent ? [0, 100] : [0, "auto"]}
              tickFormatter={(value: number) =>
                `${Number(value.toFixed(2))}${percent ? "%" : unit === "h" || unit === "h/day" ? ` ${unit}` : ""}`
              }
            />
            <Tooltip
              content={
                hoverSeriesOnly
                  ? ({ active, payload, label }) => {
                      const index = series.findIndex(
                        (item) => item.id === hovered,
                      );
                      const item = series[index];
                      const point = payload?.find(
                        (entry) => entry.dataKey === `series${index}`,
                      );
                      if (!active || !item || !point) return null;
                      return (
                        <div className={s.hovercard}>
                          <div>{date.full(Number(label))}</div>
                          <strong style={{ color: seriesColor(index) }}>
                            {item.name}
                          </strong>
                          <div>
                            {Number(point.value).toLocaleString(undefined, {
                              maximumFractionDigits: 2,
                            })}
                            {percent ? "%" : ` ${unit}`}
                          </div>
                        </div>
                      );
                    }
                  : undefined
              }
              labelFormatter={(value) =>
                bucketed
                  ? `${date.full(Math.max(bounds.start, Number(value) - bounds.width))} – ${date.full(Number(value))}`
                  : date.full(Number(value))
              }
              formatter={(value, name) => [
                `${Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 })}${percent ? "%" : ` ${unit}`}`,
                name,
              ]}
              contentStyle={{
                background: "var(--background)",
                color: "var(--text-on-light)",
                borderRadius: 6,
              }}
              itemStyle={{ whiteSpace: "normal" }}
              wrapperStyle={{ zIndex: 10, maxWidth: "min(400px, 85vw)" }}
            />
            {series.map((item, index) =>
              stacked && !item.lineOnly ? (
                <Area
                  key={item.id}
                  name={
                    item.subtitle
                      ? `${item.name} · ${item.subtitle}`
                      : item.name
                  }
                  dataKey={`series${index}`}
                  stackId="listening"
                  activeDot={hoverSeriesOnly ? false : undefined}
                  type="linear"
                  stroke={seriesColor(index)}
                  fill={seriesColor(index)}
                  fillOpacity={
                    highlighted && highlighted !== item.id ? 0.15 : 0.75
                  }
                  onMouseEnter={
                    hoverSeriesOnly ? () => setHovered(item.id) : undefined
                  }
                  onMouseLeave={
                    hoverSeriesOnly ? () => setHovered(null) : undefined
                  }
                  isAnimationActive={false}
                />
              ) : (
                <Line
                  key={item.id}
                  name={
                    item.subtitle
                      ? `${item.name} · ${item.subtitle}`
                      : item.name
                  }
                  dataKey={`series${index}`}
                  type="linear"
                  stroke={seriesColor(index)}
                  strokeWidth={highlighted === item.id ? 3 : 2}
                  strokeDasharray={item.lineOnly ? "6 4" : undefined}
                  onMouseEnter={
                    hoverSeriesOnly ? () => setHovered(item.id) : undefined
                  }
                  onMouseLeave={
                    hoverSeriesOnly ? () => setHovered(null) : undefined
                  }
                  strokeOpacity={
                    highlighted && highlighted !== item.id ? 0.2 : 1
                  }
                  dot={false}
                  activeDot={hoverSeriesOnly ? false : { r: 4 }}
                  connectNulls={false}
                  isAnimationActive={false}
                />
              ),
            )}
          </Chart>
        </ResponsiveContainer>
      </div>
      {showLegend && (
        <div className={s.legend} aria-label="Highlight a chart series">
          {series.map((item, index) => (
            <button
              key={item.id}
              type="button"
              className={s.legenditem}
              onMouseEnter={() => setHovered(item.id)}
              onMouseLeave={() => setHovered(null)}
              onFocus={() => setHovered(item.id)}
              onBlur={() => setHovered(null)}
              onClick={() => setPinned(pinned === item.id ? null : item.id)}
              aria-pressed={pinned === item.id}>
              <span
                className={s.swatch}
                style={{ background: seriesColor(index) }}
              />
              {!!item.images?.length && (
                <IdealImage images={item.images} size={36} alt="" />
              )}
              <span className={s.legendlabel}>
                <span>{item.name}</span>
                {item.subtitle && <small>{item.subtitle}</small>}
                {item.value && <small>{item.value}</small>}
              </span>
            </button>
          ))}
        </div>
      )}
    </>
  );
}
