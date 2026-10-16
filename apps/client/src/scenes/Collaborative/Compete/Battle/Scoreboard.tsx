import { BattleSide } from "../../../../services/battle";

import s from "./index.module.css";

// The month's wins on each side, and while a fight runs, what is left of
// each team.
export default function Scoreboard({
  names,
  colors,
  wins,
  left,
  day,
  health,
  delay = 0,
}: {
  names: string[];
  colors: string[];
  wins: number[];
  left: BattleSide;
  day: string;
  health?: number[];
  delay?: number;
}) {
  const sides = [left, 1 - left];
  return (
    <div className={s.scoreboard}>
      {sides.map((side, index) => (
        <div
          key={side}
          className={s.side}
          data-side={index ? "right" : "left"}
          style={{ color: colors[side] }}>
          <div className={s.sideLabel}>
            <span>{names[side]}</span>
            <strong>{wins[side]}</strong>
          </div>
          {health && (
            <div className={s.teamHealth}>
              <span
                style={{
                  width: `${100 * health[side]!}%`,
                  background: colors[side],
                  transitionDelay: `${delay}ms`,
                }}
              />
            </div>
          )}
        </div>
      ))}
      <div className={s.date}>
        {new Date(`${day}T00:00:00Z`).toLocaleDateString(undefined, {
          weekday: "short",
          day: "numeric",
          month: "short",
          timeZone: "UTC",
        })}
      </div>
    </div>
  );
}
