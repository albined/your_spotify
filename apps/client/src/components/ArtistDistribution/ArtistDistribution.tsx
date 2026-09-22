import { Button, CircularProgress } from "@mui/material";
import {
  type PointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useSelector } from "react-redux";

import { api } from "../../services/apis/api";
import {
  type ArtistDistribution as Distribution,
  buildArtistStream,
} from "../../services/artistDistribution";
import { calendarAxis } from "../../services/calendarAxis";
import { useListeningRequest } from "../../services/listeningTimeline";
import { selectRawIntervalDetail } from "../../services/redux/modules/user/selector";
import ArtistEras from "../ListeningPatterns/ArtistEras";
import TitleCard from "../TitleCard";

import s from "./index.module.css";

function Stream({ data }: { data: Distribution }) {
  const viewport = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [hover, setHover] = useState<{
    band: number;
    sample: number;
    x: number;
    y: number;
  } | null>(null);
  const stream = useMemo(() => buildArtistStream(data), [data]);
  const { bands, maximum, samples } = stream;
  const activeBand = hover?.band;
  const axis = useMemo(() => {
    const span = data.end - data.start;
    const { ticks, format } = calendarAxis(
      data.start,
      data.end,
      span <= 2 * 86400000 ? "hour" : span <= 62 * 86400000 ? "day" : "month",
      data.timezone,
      size.width,
    );
    const formatter = new Intl.DateTimeFormat(undefined, {
      ...format,
      timeZone: data.timezone,
    });
    return ticks.map((timestamp) => ({
      timestamp,
      x: ((timestamp - data.start) / span) * size.width,
      label: formatter.format(timestamp),
    }));
  }, [data, size.width]);
  const date = useMemo(
    () =>
      new Intl.DateTimeFormat(undefined, {
        timeZone: data.timezone,
        month: "short",
        day: "numeric",
        ...(data.end - data.start > 365 * 86400000
          ? { year: "2-digit" as const }
          : {}),
        ...(data.end - data.start <= 2 * 86400000
          ? { hour: "numeric" as const }
          : {}),
      }),
    [data],
  );

  useEffect(() => {
    if (!viewport.current) return;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const { width, height } = entry.contentRect;
      setSize((previous) =>
        previous.width === width && previous.height === height
          ? previous
          : { width, height },
      );
    });
    // Measure the layout container, independently of the canvas pixel buffer.
    observer.observe(viewport.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const node = canvas.current;
    const ctx = node?.getContext("2d");
    if (!node || !ctx || !size.width || !size.height || !maximum) return;
    const ratio = window.devicePixelRatio || 1;
    node.width = Math.round(size.width * ratio);
    node.height = Math.round(size.height * ratio);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    const x = (i: number) => (i / (samples - 1)) * size.width;
    const y = (v: number) =>
      size.height / 2 - (v / maximum) * (size.height - 24);
    bands.forEach((band, index) => {
      ctx.beginPath();
      ctx.moveTo(0, y(band.upper[0]!));
      for (let i = 1; i < samples; i++) ctx.lineTo(x(i), y(band.upper[i]!));
      for (let i = samples - 1; i >= 0; i--)
        ctx.lineTo(x(i), y(band.lower[i]!));
      ctx.closePath();
      ctx.fillStyle = band.color;
      ctx.globalAlpha =
        activeBand === undefined || activeBand === index ? 1 : 0.38;
      ctx.fill();
    });
    ctx.globalAlpha = 1;
  }, [bands, maximum, samples, size, activeBand]);

  const selected = hover ? bands[hover.band] : undefined;
  const hoveredTimestamp = hover
    ? data.start + (hover.sample / (samples - 1)) * (data.end - data.start)
    : data.start;
  const interpolate = (values: Float64Array, sample: number) => {
    const i = Math.min(samples - 2, Math.floor(sample));
    const fraction = sample - i;
    return values[i]! * (1 - fraction) + values[i + 1]! * fraction;
  };
  const density =
    selected && hover ? interpolate(selected.values, hover.sample) : 0;
  const inspectPointer = (event: PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const sample = Math.max(
      0,
      Math.min(samples - 1, (x / rect.width) * (samples - 1)),
    );
    const value = ((rect.height / 2 - y) / (rect.height - 24)) * maximum;
    const band = bands.findIndex(
      (item) =>
        value >= interpolate(item.lower, sample) &&
        value < interpolate(item.upper, sample),
    );
    setHover(band < 0 ? null : { band, sample, x, y });
  };

  if (!bands.length) return <p>No listening history in this period.</p>;
  return (
    <div className={s.plot}>
      <div ref={viewport} className={s.viewport}>
        <canvas
          ref={canvas}
          className={s.canvas}
          tabIndex={0}
          role="img"
          aria-label="Artist distribution over time. Band thickness shows listening intensity. Hover or tap a band for its artist. Use up and down arrows for artists, left and right for dates."
          onPointerLeave={(event) => {
            if (event.pointerType !== "touch") setHover(null);
          }}
          onPointerCancel={() => setHover(null)}
          onBlur={() => setHover(null)}
          onPointerMove={inspectPointer}
          onPointerDown={(event) => {
            event.currentTarget.focus({ preventScroll: true });
            inspectPointer(event);
          }}
          onKeyDown={(event) => {
            if (!event.key.startsWith("Arrow")) return;
            event.preventDefault();
            const band = Math.max(
              0,
              Math.min(
                bands.length - 1,
                (hover?.band ?? 0) +
                  (event.key === "ArrowUp"
                    ? 1
                    : event.key === "ArrowDown"
                      ? -1
                      : 0),
              ),
            );
            const sample = Math.max(
              0,
              Math.min(
                samples - 1,
                (hover?.sample ?? bands[band]!.peak) +
                  (event.key === "ArrowRight"
                    ? 4
                    : event.key === "ArrowLeft"
                      ? -4
                      : 0),
              ),
            );
            setHover({
              band,
              sample,
              x: (sample / (samples - 1)) * size.width,
              y: size.height / 2,
            });
          }}
        />
      </div>
      <svg className={s.axis} width="100%" height={32} aria-hidden="true">
        {axis.map(({ timestamp, x, label }) => (
          <text
            key={timestamp}
            data-timestamp={timestamp}
            x={x}
            y={24}
            textAnchor={
              x < 40 ? "start" : x > size.width - 40 ? "end" : "middle"
            }>
            {label}
          </text>
        ))}
      </svg>
      {selected && hover && (
        <div
          className={s.tooltip}
          role="status"
          style={{
            left: Math.max(
              4,
              Math.min(
                size.width - Math.min(260, size.width) - 4,
                hover.x + 16,
              ),
            ),
            top: Math.max(4, hover.y - 88),
          }}>
          {selected.artist.image && <img src={selected.artist.image} alt="" />}
          <div>
            <strong>{selected.artist.name}</strong>
            <span>{date.format(hoveredTimestamp)}</span>
            <span>
              {density > 0 && density < 0.01
                ? "<0.01"
                : density.toLocaleString(undefined, {
                    maximumFractionDigits: 2,
                  })}{" "}
              h/day
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

export default function ArtistDistribution() {
  const { interval } = useSelector(selectRawIntervalDetail);
  const start = interval.start.getTime();
  const end = interval.end.getTime();
  const request = useCallback(
    () => api.getArtistDistribution(new Date(start), new Date(end)),
    [start, end],
  );
  const { data, error, retry } = useListeningRequest(request);
  return (
    <div className={s.cards}>
      <TitleCard title="Artist distribution">
        {error ? (
          <div className={s.loading}>
            Could not load artist distribution.{" "}
            <Button onClick={retry}>Retry</Button>
          </div>
        ) : data ? (
          <Stream key={`${start}:${end}`} data={data} />
        ) : (
          <div className={s.loading}>
            <CircularProgress
              size={24}
              aria-label="Loading artist distribution"
            />
          </div>
        )}
      </TitleCard>
      <ArtistEras />
    </div>
  );
}
