import { Button, CircularProgress, Tooltip, useTheme } from "@mui/material";
import { Fragment, useEffect, useRef, useState } from "react";

import { heatmapIntensity, HeatRow } from "../../services/listeningPatterns";
import {
  HEATMAP_LABEL_WIDTH,
  HEATMAP_PITCH,
} from "../../services/matrixLayout";

import s from "./index.module.css";

export function RequestState({
  error,
  retry,
}: {
  error?: boolean;
  retry: () => void;
}) {
  return (
    <div className={s.status}>
      {error ? (
        <>
          Could not load listening history.{" "}
          <Button onClick={retry}>Retry</Button>
        </>
      ) : (
        <CircularProgress size={24} aria-label="Loading listening history" />
      )}
    </div>
  );
}

export function usePlotWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(Math.max(1, entry.contentRect.width));
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return { ref, width };
}

export function Heatmap({
  rows,
  columns,
  label,
  labelWidth = HEATMAP_LABEL_WIDTH,
  minPitch = HEATMAP_PITCH,
  maxPitch = HEATMAP_PITCH,
  centerColumnLabels = false,
  rowWeight = 0,
  maxHeight,
}: {
  rows: HeatRow[];
  columns: string[];
  label: string;
  labelWidth?: number;
  minPitch?: number;
  maxPitch?: number;
  centerColumnLabels?: boolean;
  rowWeight?: number;
  maxHeight?: number;
}) {
  const dark = useTheme().palette.mode === "dark";
  const firstCell =
    rows.flatMap((row, r) =>
      row.cells.flatMap((cell, c) => (cell ? [r * columns.length + c] : [])),
    )[0] ?? 0;
  const [focused, setFocused] = useState(firstCell);
  const maximum = Math.max(
    0,
    ...rows.flatMap((row) => row.cells.map((cell) => cell?.value ?? 0)),
  );
  const floor = dark ? 12 : 8;
  return (
    <div className={s.scroll} style={{ maxHeight }}>
      <div
        className={s.grid}
        role="group"
        aria-label={label}
        style={{
          gridTemplateColumns: `${labelWidth}px repeat(${columns.length}, minmax(${minPitch}px, ${maxPitch}px))`,
          minWidth: labelWidth + columns.length * minPitch,
        }}>
        <div className={s.columns}>
          <span className={s.row} />
          {columns.map((column, index) => (
            <span
              key={index}
              className={s.column}
              style={centerColumnLabels ? { textAlign: "center" } : undefined}>
              {column}
            </span>
          ))}
        </div>
        {rows.map((row, r) => {
          const rowMaximum = Math.max(
            0,
            ...row.cells.map((cell) => cell?.value ?? 0),
          );
          return (
            <Fragment key={row.id}>
              <span className={s.row} title={row.label}>
                {row.label}
              </span>
              {row.cells.map((cell, c) => {
                const index = r * columns.length + c;
                if (!cell) return <span key={c} className={s.blank} />;
                return (
                  <Tooltip key={c} title={cell.label} arrow enterTouchDelay={0}>
                    <button
                      type="button"
                      className={s.cell}
                      aria-label={cell.label}
                      data-cell={index}
                      tabIndex={
                        index ===
                        (rows[Math.floor(focused / columns.length)]?.cells[
                          focused % columns.length
                        ]
                          ? focused
                          : firstCell)
                          ? 0
                          : -1
                      }
                      onFocus={() => setFocused(index)}
                      onKeyDown={(event) => {
                        const step = {
                          ArrowLeft: -1,
                          ArrowRight: 1,
                          ArrowUp: -columns.length,
                          ArrowDown: columns.length,
                        }[event.key];
                        if (!step) return;
                        event.preventDefault();
                        let next = index + step;
                        while (
                          next >= 0 &&
                          next < rows.length * columns.length
                        ) {
                          const target = event.currentTarget
                            .closest('[role="group"]')
                            ?.querySelector<HTMLButtonElement>(
                              `[data-cell="${next}"]`,
                            );
                          if (target) {
                            target.focus();
                            break;
                          }
                          next += step;
                        }
                      }}
                      style={{
                        background:
                          cell.value > 0 && maximum > 0
                            ? `color-mix(in srgb, ${dark ? "#65d6a0" : "#147d50"} ${floor + heatmapIntensity(cell.value, maximum, rowMaximum, rowWeight) * (100 - floor)}%, var(--background))`
                            : "rgba(var(--primary-tuple), 0.07)",
                      }}
                    />
                  </Tooltip>
                );
              })}
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}
