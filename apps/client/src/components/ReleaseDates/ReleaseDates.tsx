import { Button, CircularProgress, Tooltip, useTheme } from "@mui/material";
import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { useSelector } from "react-redux";

import { api } from "../../services/apis/api";
import { useListeningRequest } from "../../services/listeningTimeline";
import { HEATMAP_LABEL_WIDTH } from "../../services/matrixLayout";
import { selectRawIntervalDetail } from "../../services/redux/modules/user/selector";
import {
  decadeColor,
  releaseMatrix,
  type ReleaseDistribution,
} from "../../services/releaseDistribution";
import TitleCard from "../TitleCard";

import s from "./index.module.css";

const hours = (value: number) =>
  `${value > 0 && value < 0.01 ? "<0.01" : value.toLocaleString(undefined, { maximumFractionDigits: 2 })} h`;

function Histogram({
  data,
  width,
}: {
  data: ReleaseDistribution;
  width: number;
}) {
  const first = data.years[0]?.year;
  const last = data.years.at(-1)?.year;
  if (first === undefined || last === undefined)
    return <p>No release dates available in this period.</p>;
  const peak = Math.max(1, ...data.years.map((row) => row.hours));
  const magnitude = 10 ** Math.floor(Math.log10(peak));
  const maximum = Math.ceil(peak / magnitude) * magnitude;
  const span = last - first + 1;
  const plotWidth = Math.max(width - 54, span * 2);
  const step = plotWidth / span;
  const tickStep = Math.max(
    1,
    Math.ceil(span / (width < 500 ? 4 : 10) / 5) * 5,
  );
  const ticks = Array.from(
    { length: Math.floor(last / tickStep) - Math.ceil(first / tickStep) + 1 },
    (_, i) => (Math.ceil(first / tickStep) + i) * tickStep,
  );
  return (
    <div className={s.scroll}>
      <svg
        width={plotWidth + 54}
        height={282}
        role="group"
        aria-label="Listening hours by release year"
        className={s.histogram}>
        {[0, 0.5, 1].map((part) => (
          <g key={part}>
            <line
              x1={48}
              x2={plotWidth + 48}
              y1={238 - part * 206}
              y2={238 - part * 206}
              className={s.gridline}
            />
            <text x={40} y={242 - part * 206} textAnchor="end">
              {(maximum * part).toLocaleString(undefined, {
                maximumFractionDigits: 1,
                notation: "compact",
              })}
            </text>
          </g>
        ))}
        <text x={48} y={15}>
          Hours
        </text>
        {data.years.map((row) => (
          <Tooltip
            key={row.year}
            title={`${row.year} · ${hours(row.hours)}`}
            arrow
            enterTouchDelay={0}>
            <rect
              x={48 + (row.year - first) * step + 0.5}
              y={238 - (row.hours / maximum) * 206}
              width={Math.max(1, step - 1)}
              height={(row.hours / maximum) * 206}
              rx={Math.min(2, step / 4)}
              fill={decadeColor(row.year)}
              tabIndex={0}
              role="img"
              aria-label={`${row.year}: ${hours(row.hours)}`}
              className={s.bar}
            />
          </Tooltip>
        ))}
        {(ticks.length ? ticks : [first]).map((year) => (
          <text
            key={year}
            x={48 + (year - first + 0.5) * step}
            y={261}
            textAnchor="middle">
            {year}
          </text>
        ))}
      </svg>
    </div>
  );
}

function DecadeMatrix({
  data,
  width,
}: {
  data: ReleaseDistribution;
  width: number;
}) {
  const dark = useTheme().palette.mode === "dark";
  const colorFloor = dark ? 28 : 12;
  const { rows, columns, pitch, maximum } = releaseMatrix(data, width);
  const [focused, setFocused] = useState(0);
  const date = new Intl.DateTimeFormat(undefined, {
    timeZone: data.timezone,
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
  const axisDate = new Intl.DateTimeFormat(undefined, {
    timeZone: data.timezone,
    ...(data.end - data.start < 2 * 86400000
      ? { hour: "numeric" as const }
      : {
          month: "short" as const,
          ...(data.end - data.start > 365 * 86400000
            ? { year: "2-digit" as const }
            : { day: "numeric" as const }),
        }),
  });
  const count = columns * rows.length;
  const tickEvery = Math.max(1, Math.ceil(columns / (width < 500 ? 3 : 6)));
  if (!rows.length)
    return (
      <p>
        {data.years.length
          ? "No decade reaches 1% of plays in this period."
          : "No release dates available in this period."}
      </p>
    );
  return (
    <div
      className={s.matrix}
      role="group"
      aria-label="Release decades over listening time"
      style={{
        gridTemplateColumns: `${HEATMAP_LABEL_WIDTH}px repeat(${columns}, ${pitch}px)`,
      }}>
      {rows.map((row, rowIndex) => {
        const rowMaximum = Math.max(0, ...row.values);
        return (
          <Fragment key={row.decade}>
            <span className={s.rowLabel}>{row.decade}s</span>
            {row.values.map((value, col) => {
              // Emphasize phases within each decade, retaining a little of the
              // overall volume difference. Empty cells keep their neutral color.
              const intensity =
                value > 0
                  ? 0.8 * Math.sqrt(value / rowMaximum) +
                    0.2 * Math.sqrt(value / maximum)
                  : 0;
              const index = rowIndex * columns + col;
              const start =
                data.start +
                Math.floor((col * data.count) / columns) * data.width;
              const end =
                data.start +
                Math.floor(((col + 1) * data.count) / columns) * data.width;
              const label = `${row.decade}s · ${date.format(start)} – ${date.format(end - 1)} · ${hours(value)}`;
              return (
                <Tooltip key={col} title={label} arrow enterTouchDelay={0}>
                  <button
                    type="button"
                    className={s.cell}
                    aria-label={label}
                    data-cell={index}
                    tabIndex={index === Math.min(focused, count - 1) ? 0 : -1}
                    onFocus={() => setFocused(index)}
                    onKeyDown={(event) => {
                      const offsets: Record<string, number> = {
                        ArrowLeft: -1,
                        ArrowRight: 1,
                        ArrowUp: -columns,
                        ArrowDown: columns,
                      };
                      const offset = offsets[event.key];
                      if (offset === undefined) return;
                      event.preventDefault();
                      const next = Math.max(
                        0,
                        Math.min(count - 1, index + offset),
                      );
                      event.currentTarget
                        .closest('[role="group"]')
                        ?.querySelector<HTMLButtonElement>(
                          `[data-cell="${next}"]`,
                        )
                        ?.focus();
                    }}
                    style={{
                      width: pitch - 3,
                      height: pitch - 3,
                      background:
                        value > 0
                          ? `color-mix(in srgb, ${decadeColor(row.decade)} ${colorFloor + intensity * (100 - colorFloor)}%, var(--background))`
                          : "rgba(var(--primary-tuple), 0.06)",
                    }}
                  />
                </Tooltip>
              );
            })}
          </Fragment>
        );
      })}
      <span />
      {Array.from({ length: columns }, (_, col) => (
        <span key={col} className={s.dateLabel}>
          {col % tickEvery === 0
            ? axisDate.format(
                data.start +
                  Math.floor((col * data.count) / columns) * data.width,
              )
            : ""}
        </span>
      ))}
    </div>
  );
}

export default function ReleaseDates() {
  const container = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(320);
  const { interval } = useSelector(selectRawIntervalDetail);
  const start = interval.start.getTime();
  const end = interval.end.getTime();
  const request = useCallback(
    () => api.getReleaseDistribution(new Date(start), new Date(end)),
    [start, end],
  );
  const { data, error, retry } = useListeningRequest(request);
  useEffect(() => {
    if (!container.current) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(Math.max(100, entry.contentRect.width - 40));
    });
    observer.observe(container.current);
    return () => observer.disconnect();
  }, []);
  const status = error ? (
    <div className={s.loading}>
      Could not load release dates. <Button onClick={retry}>Retry</Button>
    </div>
  ) : (
    <div className={s.loading}>
      <CircularProgress size={24} aria-label="Loading release dates" />
    </div>
  );
  return (
    <div ref={container} className={s.cards}>
      <TitleCard title="Release years">
        {data ? <Histogram data={data} width={width} /> : status}
      </TitleCard>
      <TitleCard title="Release decades over time">
        {data ? (
          <DecadeMatrix key={`${start}:${end}`} data={data} width={width} />
        ) : (
          status
        )}
      </TitleCard>
    </div>
  );
}
