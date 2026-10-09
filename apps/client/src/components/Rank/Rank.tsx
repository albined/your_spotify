import clsx from "clsx";

import { DateFormatter } from "../../services/date";
import { RankChange } from "../../services/topMovement";

import s from "./index.module.css";

interface RankProps {
  rank: number;
  movement?: RankChange;
}

const medals = ["gold", "silver", "bronze"];

function describe({ change, since }: RankChange) {
  const date = DateFormatter.toDayMonthYear(since);
  if (change === null) return `New since ${date}`;
  return `${change > 0 ? "Up" : "Down"} ${Math.abs(change)} since ${date}`;
}

export default function Rank({ rank, movement }: RankProps) {
  const moved = movement && movement.change !== 0 ? movement : undefined;
  const label = moved && describe(moved);
  return (
    <div className={s.root} title={label}>
      <span data-medal={medals[rank - 1]}>{rank}</span>
      {moved && (
        <>
          <span
            aria-hidden="true"
            className={clsx(
              s.marker,
              moved.change === null
                ? s.fresh
                : moved.change > 0
                  ? s.up
                  : s.down,
            )}
          />
          <span className={s.screenReaderOnly}>{label}</span>
        </>
      )}
    </div>
  );
}
