import { Tooltip } from "@mui/material";
import { useCallback } from "react";
import { useSelector } from "react-redux";

import { api } from "../../services/apis/api";
import { artistColor } from "../../services/artistDistribution";
import {
  ArtistActivityData,
  formatHours,
} from "../../services/listeningPatterns";
import { useListeningRequest } from "../../services/listeningTimeline";
import { selectRawIntervalDetail } from "../../services/redux/modules/user/selector";
import TitleCard from "../TitleCard";
import { RequestState, usePlotWidth } from "./shared";

import s from "./index.module.css";

function Scatter({ data, width }: { data: ArtistActivityData; width: number }) {
  const height = 340;
  const left = 56;
  const top = 44;
  const right = Math.max(left + 1, width - 30);
  const bottom = height - 48;
  const maxDays = Math.max(
    1,
    ...data.artists.map((artist) => artist.activeDays),
  );
  const maxPeak = Math.max(
    0.01,
    ...data.artists.map((artist) => artist.peakHoursPerDay),
  );
  const maxHours = Math.max(1, ...data.artists.map((artist) => artist.hours));
  const xMaximum = Math.ceil(maxDays / 4) * 4;
  const yMaximum = Math.ceil(maxPeak * 10) / 10;
  const x = (value: number) => left + (value / xMaximum) * (right - left);
  const y = (value: number) =>
    bottom - Math.sqrt(value / yMaximum) * (bottom - top);
  return (
    <svg
      className={s.scatter}
      width={width}
      height={height}
      role="group"
      aria-label="Artist activity: active days and peak seven-day listening intensity">
      <text x={left} y={16}>
        Peak 7-day intensity (h/day)
      </text>
      {[0, 1, 2, 3, 4].map((tick) => {
        const value = (tick / 4) ** 2 * yMaximum;
        return (
          <g key={tick}>
            <line
              className={s.guide}
              x1={left}
              x2={right}
              y1={y(value)}
              y2={y(value)}
            />
            <text x={left - 10} y={y(value) + 4} textAnchor="end">
              {value.toLocaleString(undefined, { maximumFractionDigits: 2 })}
            </text>
            <text
              x={x((tick * xMaximum) / 4)}
              y={bottom + 20}
              textAnchor="middle">
              {(tick * xMaximum) / 4}
            </text>
          </g>
        );
      })}
      <text x={(left + right) / 2} y={height - 5} textAnchor="middle">
        Active days
      </text>
      {data.artists.map((artist) => {
        const label = `${artist.name} · ${artist.activeDays} active days · ${formatHours(artist.peakHoursPerDay)}/day peak · ${formatHours(artist.hours)} total`;
        return (
          <Tooltip
            key={artist.id}
            arrow
            enterTouchDelay={0}
            title={
              <div className={s.artistTip}>
                {artist.image && <img src={artist.image} alt="" />}
                <div>
                  <strong>{artist.name}</strong>
                  <span>{artist.activeDays} active days</span>
                  <span>{formatHours(artist.peakHoursPerDay)}/day peak</span>
                  <span>{formatHours(artist.hours)} total</span>
                </div>
              </div>
            }>
            <circle
              className={s.bubble}
              cx={x(artist.activeDays)}
              cy={y(artist.peakHoursPerDay)}
              r={Math.max(3, 22 * Math.sqrt(artist.hours / maxHours))}
              fill={artistColor(artist.id)}
              tabIndex={0}
              role="img"
              aria-label={label}
            />
          </Tooltip>
        );
      })}
    </svg>
  );
}

function ActivityCard({ start, end }: { start: number; end: number }) {
  const { ref, width } = usePlotWidth();
  const request = useCallback(
    () => api.getArtistActivity(new Date(start), new Date(end)),
    [start, end],
  );
  const { data, error, retry } = useListeningRequest(request);
  return (
    <TitleCard title="Artist activity">
      <div className={s.plot} ref={ref}>
        {data ? (
          data.artists.length ? (
            <Scatter data={data} width={width} />
          ) : (
            <p>No listening history in this period.</p>
          )
        ) : (
          <RequestState error={error} retry={retry} />
        )}
      </div>
    </TitleCard>
  );
}

export default function ArtistActivity() {
  const { interval } = useSelector(selectRawIntervalDetail);
  const start = interval.start.getTime();
  const end = interval.end.getTime();
  return end - start < 7 * 86400000 ? null : (
    <ActivityCard start={start} end={end} />
  );
}
