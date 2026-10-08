import { useMediaQuery } from "@mui/material";
import { MouseEvent, useRef, useState } from "react";
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

export const seriesColor = (index: number) =>
  index < 10
    ? getColor(index)
    : `hsl(${(index * 137.508) % 360} 48% ${index % 2 ? 62 : 50}%)`;

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

// Height of a line where it crosses x, found by bisecting along its length.
function lineHeightAt(path: SVGPathElement, x: number) {
  let low = 0;
  let high = path.getTotalLength();
  for (let i = 0; i < 24; i += 1) {
    const middle = (low + high) / 2;
    if (path.getPointAtLength(middle).x < x) low = middle;
    else high = middle;
  }
  const point = path.getPointAtLength(high);
  return Math.abs(point.x - x) > 8 ? null : point.y;
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
  legendPosition?: "bottom" | "right";
  hoverSeriesOnly?: boolean;
  // False for lines that fill the plot's left side, where labels would clash.
  insetScale?: boolean;
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
  legendPosition = "bottom",
  hoverSeriesOnly = false,
  insetScale = true,
}: Props) {
  const [hovered, setHovered] = useState<string | null>(null);
  const [pinned, setPinned] = useState<string | null>(null);
  const candidate = hovered ?? pinned;
  const highlighted = series.some((item) => item.id === candidate)
    ? candidate
    : null;
  const date = useTimelineDate(bounds);
  const chart = useRef<HTMLDivElement>(null);
  // A finger cannot hover: a tap picks the nearest line and shows only that
  // one, instead of a list of every series covering the chart.
  const tapToPick =
    useMediaQuery("(pointer: coarse)") && !stacked && !hoverSeriesOnly;
  const pickNearest = (event: MouseEvent) => {
    const surface = chart.current?.querySelector("svg.recharts-surface");
    if (!surface) return;
    const box = surface.getBoundingClientRect();
    const x = event.clientX - box.left;
    const y = event.clientY - box.top;
    let nearest: { id: string; distance: number } | null = null;
    series.forEach((item, index) => {
      const path = surface.querySelector<SVGPathElement>(
        `.timeline-series-${index} path.recharts-line-curve`,
      );
      const lineY = path && lineHeightAt(path, x);
      if (lineY === null || lineY === undefined) return;
      const distance = Math.abs(lineY - y);
      if (!nearest || distance < nearest.distance) {
        nearest = { id: item.id, distance };
      }
    });
    const picked = nearest as { id: string; distance: number } | null;
    setPinned(
      !picked || picked.distance > 48 || picked.id === pinned
        ? null
        : picked.id,
    );
  };
  // On a phone the scale sits inside the plot, which then spans the card and
  // shares its edges with the legend.
  const phone = useMediaQuery("(max-width: 900px)");
  const inset = phone && !stacked && insetScale;
  const single = hoverSeriesOnly ? hovered : tapToPick ? highlighted : null;
  const Chart = stacked
    ? series.some((item) => item.lineOnly)
      ? ComposedChart
      : AreaChart
    : LineChart;
  return (
    <div className={legendPosition === "right" ? s.withSideLegend : s.timeline}>
      <div
        ref={chart}
        className={s.chart}
        style={{ height }}
        onClick={tapToPick ? pickNearest : undefined}
        role="img"
        aria-label={`Listening timeline: ${series.map((item) => item.name).join(", ")}. Values in ${percent ? "percent" : unit}.`}>
        <ResponsiveContainer width="100%" height="100%">
          <Chart
            data={data}
            margin={{ top: 12, right: inset ? 2 : 16, bottom: 0, left: 0 }}
            accessibilityLayer>
            <CartesianGrid
              strokeDasharray="3 3"
              vertical={false}
              stroke="var(--chart-grid)"
            />
            <XAxis
              axisLine={false}
              tickLine={false}
              dataKey="timestamp"
              type="number"
              scale="time"
              domain={[bounds.start, bounds.end]}
              tickFormatter={date.tick}
              tick={{ fill: "var(--text-tertiary)" }}
              minTickGap={35}
            />
            <YAxis
              axisLine={false}
              tickLine={false}
              mirror={inset}
              width={unit === "h/day" ? (phone ? 68 : 80) : 65}
              allowDecimals={percent || unit === "h" || unit === "h/day"}
              tick={{
                fill: "var(--text-tertiary)",
                ...(unit === "h/day" ? { fontSize: phone ? 11 : 12 } : {}),
                ...(inset ? { fontSize: 11, dy: -8 } : {}),
              }}
              domain={percent ? [0, 100] : [0, "auto"]}
              tickFormatter={(value: number) =>
                inset && value === 0
                  ? ""
                  : `${Number(value.toFixed(2))}${percent ? "%" : unit === "h" || unit === "h/day" ? ` ${unit}` : ""}`
              }
            />
            <Tooltip
              itemSorter={stacked ? undefined : (item) => -Number(item.value)}
              content={
                hoverSeriesOnly || tapToPick
                  ? ({ active, payload, label }) => {
                      const index = series.findIndex(
                        (item) => item.id === single,
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
                  className={`timeline-series-${index}`}
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
                  activeDot={
                    hoverSeriesOnly || (tapToPick && highlighted !== item.id)
                      ? false
                      : { r: 4 }
                  }
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
              title={
                item.subtitle ? `${item.name} · ${item.subtitle}` : item.name
              }
              aria-pressed={pinned === item.id}>
              <span
                className={s.swatch}
                style={{ background: seriesColor(index) }}
              />
              {!!item.images?.length && (
                <IdealImage
                  images={item.images}
                  size={legendPosition === "right" ? 24 : 36}
                  alt=""
                />
              )}
              <span className={s.legendlabel}>
                <span>{item.name}</span>
                {legendPosition !== "right" && item.subtitle && (
                  <small>{item.subtitle}</small>
                )}
                {legendPosition !== "right" && item.value && (
                  <small>{item.value}</small>
                )}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
