import { Tooltip } from "@mui/material";
import { useYAxisScale } from "recharts";

import s from "./index.module.css";

// Keep zero visible when the average is very close to the baseline.
function markerLabelY(y: number, zero: number) {
  return zero - y < 14 ? zero - 14 : y;
}

export function VolumeTick({
  x = 0,
  y = 0,
  payload,
  average,
  format,
}: {
  x?: number;
  y?: number;
  payload?: { value: number };
  average: number | undefined;
  format: (value: number) => string;
}) {
  const scale = useYAxisScale();
  if (!payload) return null;
  const markerY =
    average !== undefined && scale
      ? markerLabelY(scale(average)!, scale(0)!)
      : undefined;
  if (
    payload.value !== 0 &&
    markerY !== undefined &&
    Math.abs(y - markerY) < 13
  )
    return null;
  return (
    <text
      x={x}
      y={y}
      dy="0.35em"
      textAnchor="end"
      fill="var(--text-on-light)"
      fontSize={11}>
      {format(payload.value)}
    </text>
  );
}

export function AverageMarker({
  x1 = 0,
  y1 = 0,
  label,
}: {
  x1?: number;
  y1?: number;
  label: string;
}) {
  const scale = useYAxisScale();
  const textY = markerLabelY(y1, scale?.(0) ?? y1);
  return (
    <Tooltip title={label} placement="right">
      <g className={s.averageMarker} tabIndex={0} role="img" aria-label={label}>
        <rect
          x={x1 - 40}
          y={Math.min(y1, textY) - 10}
          width={48}
          height={Math.abs(y1 - textY) + 20}
          fill="transparent"
        />
        <line
          x1={x1 - 4}
          x2={x1 + 4}
          y1={y1}
          y2={y1}
          stroke="currentColor"
          strokeWidth={1.5}
        />
        <text
          x={x1 - 9}
          y={textY}
          dy="0.35em"
          textAnchor="end"
          fill="currentColor"
          fontSize={11}>
          avg
        </text>
      </g>
    </Tooltip>
  );
}
