import { MenuItem, Select } from "@mui/material";
import {
  type PointerEvent,
  useCallback,
  useId,
  useMemo,
  useState,
} from "react";
import { useSelector } from "react-redux";

import { api } from "../../../services/apis/api";
import { buildHourlyMix, HourlyMixData } from "../../../services/hourlyMix";
import { useListeningRequest } from "../../../services/listeningTimeline";
import { selectRawIntervalDetail } from "../../../services/redux/modules/user/selector";
import { RequestState, usePlotWidth } from "../../ListeningPatterns/shared";
import TitleCard from "../../TitleCard";
import { ImplementedChartProps } from "../types";

import s from "./index.module.css";

const choices = {
  artists: { label: "Artists", call: api.getBestArtistsOfHour },
  albums: { label: "Albums", call: api.getBestAlbumsOfHour },
  tracks: { label: "Songs", call: api.getBestSongsOfHour },
};
type Kind = keyof typeof choices;
const hourLabel = (hour: number) => String(hour).padStart(2, "0");

function HourlyMix({ data }: { data: HourlyMixData[] }) {
  const { ref, width } = usePlotWidth();
  const id = useId();
  const hours = useMemo(() => buildHourlyMix(data), [data]);
  const [active, setActive] = useState<{ hour: number; index: number } | null>(
    null,
  );
  const left = 36;
  const top = 12;
  const bottom = 188;
  const pitch = Math.max(1, (width - left - 4) / 24);
  const barWidth = Math.max(1, pitch - Math.min(4, pitch * 0.25));
  const selected = active ? hours[active.hour] : undefined;
  const segment = active ? selected?.segments[active.index] : undefined;
  const inspect = (event: PointerEvent<SVGSVGElement>) => {
    const target =
      event.target instanceof Element
        ? event.target.closest("[data-hour]")
        : null;
    if (!target) {
      setActive(null);
      return;
    }
    const hour = Number(target.getAttribute("data-hour"));
    const index = Number(target.getAttribute("data-segment") ?? 0);
    setActive((previous) =>
      previous?.hour === hour && previous.index === index
        ? previous
        : { hour, index },
    );
  };
  if (!hours.some((hour) => hour.total))
    return <p>No listening history in this period.</p>;
  return (
    <div className={s.plot} ref={ref}>
      <svg
        className={s.chart}
        width="100%"
        height={216}
        tabIndex={0}
        role="img"
        aria-label="Hourly listening mix, as a percentage of plays at each hour. Hover or tap a section for details. Use left and right arrows for hours, up and down for items."
        onPointerMove={inspect}
        onPointerDown={(event) => {
          event.currentTarget.focus({ preventScroll: true });
          inspect(event);
        }}
        onPointerLeave={(event) => {
          if (event.pointerType !== "touch") setActive(null);
        }}
        onPointerCancel={() => setActive(null)}
        onFocus={() =>
          setActive(
            (previous) =>
              previous ?? {
                hour: hours.findIndex((hour) => hour.total > 0),
                index: 0,
              },
          )
        }
        onBlur={() => setActive(null)}
        onKeyDown={(event) => {
          if (event.key === "Escape") setActive(null);
          if (!event.key.startsWith("Arrow")) return;
          event.preventDefault();
          const hour = Math.max(
            0,
            Math.min(
              23,
              (active?.hour ?? 0) +
                (event.key === "ArrowRight"
                  ? 1
                  : event.key === "ArrowLeft"
                    ? -1
                    : 0),
            ),
          );
          const index = Math.max(
            0,
            Math.min(
              hours[hour]!.segments.length - 1,
              (active?.index ?? 0) +
                (event.key === "ArrowUp"
                  ? 1
                  : event.key === "ArrowDown"
                    ? -1
                    : 0),
            ),
          );
          setActive({ hour, index });
        }}>
        {[0, 50, 100].map((value) => (
          <text
            key={value}
            x={left - 8}
            y={bottom - (value / 100) * (bottom - top) + 4}
            textAnchor="end">
            {value}%
          </text>
        ))}
        {hours.map((hour) => {
          const x = left + hour.hour * pitch;
          return (
            <g key={hour.hour}>
              <defs>
                <clipPath id={id + "-" + hour.hour}>
                  <rect
                    x={x}
                    y={top}
                    width={barWidth}
                    height={bottom - top}
                    rx={3}
                  />
                </clipPath>
              </defs>
              <g clipPath={"url(#" + id + "-" + hour.hour + ")"}>
                <rect
                  data-hour={hour.hour}
                  x={x}
                  y={top}
                  width={barWidth}
                  height={bottom - top}
                  fill="rgba(var(--primary-tuple), 0.05)"
                />
                {hour.segments.map((item, index) => (
                  <rect
                    key={item.id}
                    data-hour={hour.hour}
                    data-segment={index}
                    x={x}
                    y={bottom - (item.bottom + item.share) * (bottom - top)}
                    width={barWidth}
                    height={item.share * (bottom - top)}
                    fill={item.color}
                  />
                ))}
              </g>
              {hour.hour % (width < 480 ? 3 : width < 640 ? 2 : 1) === 0 && (
                <text x={x + barWidth / 2} y={bottom + 22} textAnchor="middle">
                  {hourLabel(hour.hour)}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      {selected && (
        <div
          className={s.tooltip}
          role="status"
          style={{
            left: Math.max(
              0,
              Math.min(
                width - Math.min(240, width),
                left + selected.hour * pitch - 100,
              ),
            ),
          }}>
          {segment?.image && <img src={segment.image} alt="" />}
          <div>
            <span>
              {hourLabel(selected.hour)}:00–{hourLabel(selected.hour + 1)}:00
            </span>
            <strong>{segment?.name ?? "No plays"}</strong>
            {segment && (
              <span>
                {(segment.share * 100).toLocaleString(undefined, {
                  maximumFractionDigits: 1,
                })}
                % · {segment.count.toLocaleString()} plays
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function HourlyRequest({
  kind,
  start,
  end,
}: {
  kind: Kind;
  start: number;
  end: number;
}) {
  const request = useCallback(
    async () => ({
      data: (await choices[kind].call(new Date(start), new Date(end))).data,
    }),
    [kind, start, end],
  );
  const { data, error, retry } = useListeningRequest(request);
  return data ? (
    <HourlyMix data={data} />
  ) : (
    <RequestState error={error} retry={retry} />
  );
}

export default function BestOfHour({ className }: ImplementedChartProps) {
  const { interval } = useSelector(selectRawIntervalDetail);
  const [kind, setKind] = useState<Kind>("artists");
  const start = interval.start.getTime();
  const end = interval.end.getTime();
  return (
    <TitleCard
      title={choices[kind].label + " by hour"}
      className={className}
      right={
        <Select
          value={kind}
          onChange={(event) => setKind(event.target.value as Kind)}
          variant="standard"
          inputProps={{ "aria-label": "Hourly listening category" }}>
          {Object.entries(choices).map(([value, choice]) => (
            <MenuItem key={value} value={value}>
              {choice.label}
            </MenuItem>
          ))}
        </Select>
      }>
      <HourlyRequest
        key={kind + ":" + start + ":" + end}
        kind={kind}
        start={start}
        end={end}
      />
    </TitleCard>
  );
}
