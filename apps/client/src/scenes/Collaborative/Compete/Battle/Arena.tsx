import EmojiEventsRounded from "@mui/icons-material/EmojiEventsRounded";
import FastForwardRounded from "@mui/icons-material/FastForwardRounded";
import PlayArrowRounded from "@mui/icons-material/PlayArrowRounded";
import ReplayRounded from "@mui/icons-material/ReplayRounded";
import SkipNextRounded from "@mui/icons-material/SkipNextRounded";
import { IconButton } from "@mui/material";
import clsx from "clsx";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  ArtistBattle,
  BattleClass,
  BattleEvent,
  BattleSide,
  BattleSlot,
} from "../../../../services/battle";
import Figure, { FIGURE_RATIO } from "./Figure";
import Scoreboard from "./Scoreboard";

import s from "./index.module.css";

type Battle = NonNullable<ArtistBattle["battle"]>;

// Where each class stands on the left half, as fractions of the arena; the
// right team stands mirrored.
const SPOTS: Record<BattleClass, { x: number; y: number }> = {
  wizard: { x: 0.12, y: 0.5 },
  cleric: { x: 0.16, y: 0.84 },
  knight: { x: 0.33, y: 0.56 },
  rogue: { x: 0.31, y: 0.9 },
};

// How long each action takes and when it lands, in beats.
const TIMING: Record<
  BattleEvent["action"],
  { length: number; impact: number }
> = {
  slash: { length: 1, impact: 0.42 },
  stab: { length: 0.95, impact: 0.4 },
  charge: { length: 0.8, impact: 0.5 },
  spell: { length: 1.3, impact: 0.66 },
  heal: { length: 0.95, impact: 0.45 },
  smite: { length: 1, impact: 0.5 },
};
const BEAT = 900;
// Each team steps into a spotlight before they face off; a replay has both
// walk in at once.
const SPOTLIGHT = 2300;
const FACE_OFF = 1100;
const INTRO = 1700;
const WAITING = -4;
const FIRST_SPOTLIGHT = -3;
const SECOND_SPOTLIGHT = -2;
const INTRO_STEP = -1;

const classNames: Record<BattleClass, string> = {
  knight: "Knight",
  cleric: "Cleric",
  wizard: "Wizard",
  rogue: "Rogue",
};

const slotKey = ([side, slot]: BattleSlot) => `${side}:${slot}`;

function useSize(ref: React.RefObject<HTMLElement | null>) {
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const { width, height } = entry.contentRect;
      setSize({ width, height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return size;
}

const reducedMotion = () =>
  window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

export default function Arena({
  battle,
  names,
  colors,
  left,
  wins,
  seen,
  onDone,
}: {
  battle: Battle;
  names: string[];
  colors: string[];
  left: BattleSide;
  wins: number[];
  // A battle watched before opens on its result.
  seen: boolean;
  // Called once the result is on screen.
  onDone: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const bodies = useRef(new Map<string, HTMLDivElement>());
  const sprites = useRef(new Map<string, HTMLDivElement>());
  const { width, height } = useSize(ref);
  const { events, teams } = battle;
  const [step, setStep] = useState(seen ? events.length : WAITING);
  // Celebrations are kept for a fight played here.
  const [live, setLive] = useState(false);
  const [replay, setReplay] = useState(false);
  const [speed, setSpeed] = useState(1);
  const beat = BEAT / speed;
  const done = step >= events.length;
  const second = (1 - left) as BattleSide;

  // Time already spent on a step is kept when the speed changes.
  const clock = useRef({ step: WAITING, spent: 0, since: 0, speed: 1 });
  useEffect(() => {
    if (step < FIRST_SPOTLIGHT || step >= events.length) {
      clock.current.step = step;
      return;
    }
    const now = performance.now();
    const current = clock.current;
    if (current.step !== step) Object.assign(current, { step, spent: 0 });
    else current.spent += (now - current.since) * current.speed;
    Object.assign(current, { since: now, speed });
    const wait =
      step >= 0
        ? TIMING[events[step]!.action].length * BEAT
        : step === INTRO_STEP
          ? replay
            ? INTRO
            : FACE_OFF
          : SPOTLIGHT;
    const timer = setTimeout(
      () => setStep(step + 1),
      Math.max(0, wait - current.spent) / speed,
    );
    return () => clearTimeout(timer);
  }, [step, speed, events, replay]);

  useEffect(() => {
    if (done) onDone();
  }, [done, onDone]);

  const size = Math.max(50, Math.min(96, width * 0.11));
  const spot = ([side, slot]: BattleSlot) => {
    const fighter = teams[side][slot]!;
    const place = SPOTS[fighter.class];
    const onLeft = side === left;
    // Stronger fighters stand taller.
    const grown = size * (0.55 + 0.45 * Math.min(2.2, fighter.scale));
    return {
      x: (onLeft ? place.x : 1 - place.x) * width,
      y: place.y * height,
      onLeft,
      size: grown,
      tall: grown * FIGURE_RATIO,
    };
  };

  const hp = useMemo(() => {
    const values = teams.map((team) => team.map((fighter) => fighter.hp));
    for (const event of events.slice(0, Math.max(0, step + 1)))
      for (const hit of event.hits)
        values[hit.target[0]]![hit.target[1]] = hit.hp;
    return values;
  }, [teams, events, step]);
  const event = step >= 0 ? events[step] : undefined;
  const impact = event ? TIMING[event.action].impact * beat : 0;

  // Moves in flight follow a change of speed.
  const moves = useRef({ played: [] as Animation[], speed: 1 });
  useEffect(() => {
    for (const move of moves.current.played)
      move.updatePlaybackRate(speed / moves.current.speed);
  }, [speed]);

  // Moves are played on the sprites directly, so the same move twice in a
  // row restarts.
  useEffect(() => {
    const played: Animation[] = [];
    moves.current = { played, speed };
    const play = (
      element: Element | null | undefined,
      frames: Keyframe[],
      options: KeyframeAnimationOptions,
    ) => {
      if (element) played.push(element.animate(frames, options));
    };
    const entering =
      step === FIRST_SPOTLIGHT
        ? [left]
        : step === SECOND_SPOTLIGHT
          ? [second]
          : step === INTRO_STEP && replay
            ? [left, second]
            : [];
    for (const [key, body] of bodies.current) {
      const [side, slot] = key.split(":").map(Number) as BattleSlot;
      if (!entering.includes(side)) continue;
      const away = (side === left ? -1 : 1) * width * 0.45;
      // In a spotlight each fighter gets a moment of its own.
      const alone = step !== INTRO_STEP;
      play(
        body,
        [
          { transform: `translateX(${away}px)`, opacity: 0 },
          { transform: "translateY(-8px)", opacity: 1, offset: 0.75 },
          { transform: "none", opacity: 1 },
        ],
        {
          duration: (alone ? 650 : 700) / speed,
          delay: ((alone ? 300 : 120) * slot) / speed,
          easing: "cubic-bezier(.2,.8,.3,1)",
          fill: "backwards",
        },
      );
    }
    if (!event) return () => played.forEach((item) => item.cancel());
    const { length } = TIMING[event.action];
    const duration = length * beat;
    const actor = sprites.current.get(slotKey(event.actor));
    const from = spot(event.actor);
    const first = event.hits[0];
    const to = first ? spot(first.target) : from;
    const reach = (from.onLeft ? -1 : 1) * size * 0.75;
    const dx = to.x - from.x + reach;
    const dy = to.y - from.y;
    const weapon = actor?.querySelector(`.${s.weapon}`);
    const swing = (degrees: number, at: number) =>
      play(
        weapon,
        [
          { transform: "rotate(0)" },
          { transform: `rotate(${-degrees * 0.45}deg)`, offset: at * 0.7 },
          { transform: `rotate(${degrees}deg)`, offset: at },
          { transform: "rotate(0)" },
        ],
        { duration, easing: "ease-out" },
      );
    if (event.action === "slash") {
      play(
        actor,
        [
          { transform: "none" },
          { transform: `translate(${dx}px, ${dy}px)`, offset: 0.36 },
          { transform: `translate(${dx}px, ${dy}px)`, offset: 0.56 },
          { transform: "none" },
        ],
        { duration, easing: "ease-in-out" },
      );
      swing(80, 0.45);
    } else if (event.action === "stab") {
      const at = `translate(${dx}px, ${dy}px)`;
      const jab = `translate(${dx - reach * 0.25}px, ${dy}px)`;
      play(
        actor,
        [
          { transform: "none", opacity: 1 },
          { transform: "translateY(-6px)", opacity: 0, offset: 0.14 },
          { transform: at, opacity: 0, offset: 0.2 },
          { transform: at, opacity: 1, offset: 0.3 },
          { transform: jab, opacity: 1, offset: 0.4 },
          { transform: at, opacity: 1, offset: 0.62 },
          { transform: at, opacity: 0, offset: 0.72 },
          { transform: "none", opacity: 0, offset: 0.78 },
          { transform: "none", opacity: 1 },
        ],
        { duration },
      );
      swing(55, 0.42);
    } else if (event.action === "charge") {
      play(
        actor,
        [
          { transform: "none" },
          { transform: "translateY(-10px)", offset: 0.5 },
          { transform: "none" },
        ],
        { duration, easing: "ease-in-out" },
      );
    } else {
      // Spells, heals and smites are cast from where the caster stands.
      play(
        actor,
        [
          { transform: "none" },
          { transform: "translateY(-12px) scale(1.06)", offset: 0.35 },
          { transform: "none", offset: 0.7 },
          { transform: "none" },
        ],
        { duration, easing: "ease-out" },
      );
      swing(-35, 0.4);
    }
    for (const hit of event.hits) {
      const target = sprites.current.get(slotKey(hit.target));
      const away = spot(hit.target).onLeft ? -1 : 1;
      if (event.action === "heal") {
        play(
          target,
          [
            { filter: "none" },
            { filter: "drop-shadow(0 0 10px #6ef0a0) brightness(1.3)" },
            { filter: "none" },
          ],
          { duration: beat * 0.5, delay: impact },
        );
      } else if (hit.miss) {
        play(
          target,
          [
            { transform: "none" },
            { transform: `translate(${away * 18}px, -6px)`, offset: 0.4 },
            { transform: "none" },
          ],
          { duration: beat * 0.4, delay: impact - beat * 0.08 },
        );
      } else {
        play(
          target,
          [
            { transform: "none", filter: "brightness(1)" },
            {
              transform: `translateX(${away * (hit.crit ? 16 : 9)}px)`,
              filter: "brightness(2.6)",
              offset: 0.2,
            },
            { transform: `translateX(${-away * 4}px)`, offset: 0.5 },
            { transform: `translateX(${away * 2}px)`, offset: 0.75 },
            { transform: "none", filter: "brightness(1)" },
          ],
          { duration: beat * 0.42, delay: impact },
        );
        if (hit.crit)
          play(
            ref.current,
            [
              { transform: "none" },
              { transform: "translate(-4px, 2px)" },
              { transform: "translate(4px, -2px)" },
              { transform: "translate(-2px, 1px)" },
              { transform: "none" },
            ],
            { duration: beat * 0.3, delay: impact },
          );
      }
    }
    return () => played.forEach((item) => item.cancel());
    // A step is played once; the layout only places it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  const fx = event && (
    <div
      key={`effects-${step}`}
      className={s.effects}
      aria-hidden
      style={
        {
          "--beat": `${beat}ms`,
          "--impact": `${impact}ms`,
        } as React.CSSProperties
      }>
      {event.action === "charge" && (
        <span
          className={s.aura}
          style={{
            left: spot(event.actor).x,
            top: spot(event.actor).y - spot(event.actor).tall * 0.42,
            width: size * 1.3,
            height: size * 1.3,
          }}
        />
      )}
      {event.hits.map((hit, index) => {
        const target = spot(hit.target);
        const head = { left: target.x, top: target.y - target.tall * 0.62 };
        const caster = spot(event.actor);
        const tip = {
          x: caster.x + (caster.onLeft ? 1 : -1) * size * 0.3,
          y: caster.y - caster.tall * 0.66,
        };
        return (
          <span key={index}>
            {event.action === "spell" && (
              <>
                <span
                  className={s.bolt}
                  style={
                    {
                      left: tip.x,
                      top: tip.y,
                      "--dx": `${head.left - tip.x}px`,
                      "--dy": `${head.top - tip.y}px`,
                    } as React.CSSProperties
                  }
                />
                {!hit.miss && (
                  <span
                    className={s.burst}
                    style={{ ...head, width: size, height: size }}
                  />
                )}
              </>
            )}
            {event.action === "slash" && !hit.miss && (
              <span
                className={s.slash}
                style={{ ...head, width: size * 1.1, height: size * 1.1 }}
              />
            )}
            {event.action === "stab" && !hit.miss && (
              <span
                className={s.stab}
                style={{ ...head, width: size * 0.9, height: size * 0.9 }}
              />
            )}
            {event.action === "smite" && !hit.miss && (
              <span
                className={s.beam}
                style={{
                  left: target.x,
                  top: 0,
                  height: target.y - target.tall * 0.2,
                  width: size * 0.5,
                }}
              />
            )}
            {event.action === "heal" && (
              <span
                className={s.heal}
                style={{ ...head, width: size, height: size }}
              />
            )}
            {hit.ko && (
              <span
                className={s.puff}
                style={{
                  left: target.x,
                  top: target.y - target.tall * 0.3,
                  width: size * 1.5,
                  height: size * 1.5,
                }}
              />
            )}
            <span
              className={clsx(
                s.number,
                hit.crit && s.crit,
                hit.miss && s.miss,
                event.action === "heal" && s.healed,
              )}
              style={{ left: target.x, top: target.y - target.tall - 4 }}>
              {hit.miss
                ? "miss"
                : `${event.action === "heal" ? "+" : ""}${hit.amount}${hit.crit ? "!" : ""}`}
            </span>
          </span>
        );
      })}
    </div>
  );

  const winner = battle.winner;
  const health = hp.map(
    (team, side) =>
      team.reduce((sum, value) => sum + value, 0) /
      teams[side]!.reduce((sum, fighter) => sum + fighter.hp, 0),
  );
  // The winning team's fighter who dealt or healed the most.
  const mvp = useMemo(() => {
    if (winner === null) return undefined;
    const credit = new Map<number, number>();
    for (const item of events)
      if (item.actor[0] === winner)
        credit.set(
          item.actor[1],
          (credit.get(item.actor[1]) ?? 0) +
            item.hits.reduce((sum, hit) => sum + hit.amount, 0),
        );
    return [...credit].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0];
  }, [events, winner]);
  const spotlit =
    step === FIRST_SPOTLIGHT
      ? left
      : step === SECOND_SPOTLIGHT
        ? second
        : undefined;
  const start = () => {
    setLive(true);
    setStep(reducedMotion() ? events.length : FIRST_SPOTLIGHT);
  };
  const lineup = (side: number) =>
    teams[side]!.map((fighter) => fighter.name).join(", ");
  return (
    <>
      <Scoreboard
        names={names}
        colors={colors}
        wins={wins}
        left={left}
        day={battle.day}
        health={health}
        delay={event ? impact : 0}
      />
      <div
        ref={ref}
        role="group"
        aria-label={`${names[left]}: ${lineup(left)}. ${names[1 - left]}: ${lineup(1 - left)}. ${done ? (winner === null ? "Draw" : `${names[winner]} wins`) : ""}`}
        className={s.arena}
        style={
          {
            "--left": colors[left],
            "--right": colors[1 - left],
            "--beat": `${beat}ms`,
          } as React.CSSProperties
        }>
        {event && width > 0 && (
          <span
            key={`turn-${step}`}
            className={s.turn}
            aria-hidden
            style={{
              left: spot(event.actor).x,
              top: spot(event.actor).y,
              width: size * 1.2,
              height: size * 0.36,
              color: colors[event.actor[0]],
            }}
          />
        )}
        {spotlit !== undefined && (
          <div
            key={`spotlight-${step}`}
            className={s.spotlight}
            data-side={spotlit === left ? "left" : "right"}
            aria-hidden
            style={
              {
                "--color": colors[spotlit],
                "--phase": `${SPOTLIGHT / speed}ms`,
              } as React.CSSProperties
            }>
            <span className={s.herald}>{names[spotlit]}</span>
          </div>
        )}
        {width > 0 &&
          teams.map((team, side) =>
            team.map((fighter, slot) => {
              const at = spot([side as BattleSide, slot]);
              const remaining = hp[side]![slot]!;
              const down = remaining <= 0;
              const fell = event?.hits.some(
                (hit) =>
                  hit.ko && hit.target[0] === side && hit.target[1] === slot,
              );
              const cheering = live && done && winner === side && !down;
              const owner = names[side];
              return (
                <div
                  key={`${side}:${fighter.id}`}
                  ref={(element) => {
                    const key = slotKey([side as BattleSide, slot]);
                    if (element) bodies.current.set(key, element);
                    else bodies.current.delete(key);
                  }}
                  className={clsx(
                    s.fighter,
                    (step === WAITING ||
                      (step === FIRST_SPOTLIGHT && side === second)) &&
                      s.offstage,
                    step === SECOND_SPOTLIGHT && side === left && s.dimmed,
                    side === spotlit && s.presented,
                    down && s.down,
                    fell && s.falling,
                    cheering && s.cheer,
                  )}
                  data-side={at.onLeft ? "left" : "right"}
                  aria-hidden
                  style={
                    {
                      left: at.x - at.size / 2,
                      top: at.y - at.tall,
                      width: at.size,
                      zIndex: Math.round(at.y),
                      // A fighter falls once the blow has landed.
                      "--fall": `${fell ? impact + beat * 0.15 : 0}ms`,
                    } as React.CSSProperties
                  }
                  title={[
                    `${fighter.name} · ${classNames[fighter.class]}`,
                    `${Math.round(fighter.share * 100)}% of ${owner}'s listening in the last 30 days`,
                    `Played on ${fighter.loyaltyDays} days in the past year`,
                    `${fighter.songs} ${fighter.songs === 1 ? "song" : "songs"}`,
                    ...(fighter.contested
                      ? [`Won from ${names[1 - side]} in the draft`]
                      : []),
                  ].join("\n")}>
                  <div className={s.pose}>
                    <div
                      className={s.bob}
                      style={
                        cheering
                          ? undefined
                          : { animationDelay: `${-slot * 0.37 - side * 0.6}s` }
                      }>
                      <div
                        className={s.sprite}
                        ref={(element) => {
                          const key = slotKey([side as BattleSide, slot]);
                          if (element) sprites.current.set(key, element);
                          else sprites.current.delete(key);
                        }}>
                        <Figure
                          cls={fighter.class}
                          color={colors[side]!}
                          image={fighter.image}
                          name={fighter.name}
                          mirrored={!at.onLeft}
                        />
                      </div>
                    </div>
                  </div>
                  {side === spotlit && (
                    <span
                      className={s.role}
                      style={{
                        top: at.tall,
                        background: colors[side],
                        animationDelay: `${(300 * slot + 450) / speed}ms`,
                      }}>
                      {classNames[fighter.class]}
                    </span>
                  )}
                  {done && side === winner && slot === mvp && (
                    <svg className={s.crown} viewBox="0 0 24 16" aria-hidden>
                      <path
                        d="M2 14 4 3l5 5 3-7 3 7 5-5 2 11z"
                        fill="#ffd75e"
                        stroke="#b8860b"
                        strokeWidth={1.2}
                        strokeLinejoin="round"
                      />
                    </svg>
                  )}
                  <div className={s.health}>
                    <span
                      style={{
                        width: `${(100 * remaining) / fighter.hp}%`,
                        background: colors[side],
                        transitionDelay: event ? `${impact}ms` : "0ms",
                      }}
                    />
                  </div>
                  <div className={s.name}>{fighter.name}</div>
                </div>
              );
            }),
          )}
        {fx}
        {step === INTRO_STEP && (
          <div
            className={s.versus}
            aria-hidden
            style={
              {
                "--phase": `${(replay ? INTRO : FACE_OFF) / speed}ms`,
              } as React.CSSProperties
            }>
            VS
          </div>
        )}
        {step === WAITING && (
          <button type="button" className={s.start} onClick={start}>
            <PlayArrowRounded />
            Fight
          </button>
        )}
        {live && done && winner !== null && (
          <div className={s.confetti} aria-hidden>
            {Array.from({ length: 22 }, (_, index) => (
              <span
                key={index}
                style={{
                  left: `${(index * 41 + 7) % 100}%`,
                  background: [colors[winner], "#ffd75e", colors[winner]][
                    index % 3
                  ],
                  animationDelay: `${(index % 7) * 110}ms`,
                  rotate: `${(index * 67) % 360}deg`,
                }}
              />
            ))}
          </div>
        )}
        {done && (
          <div className={s.result} role="status">
            {winner === null ? (
              "Draw"
            ) : (
              <>
                <EmojiEventsRounded style={{ color: colors[winner] }} />
                <span style={{ color: colors[winner] }}>{names[winner]}</span>
                wins
              </>
            )}
          </div>
        )}
        <div className={s.controls}>
          {step === WAITING ? null : done ? (
            <IconButton
              size="small"
              aria-label="Replay"
              onClick={() => {
                setLive(true);
                setReplay(true);
                setStep(INTRO_STEP);
              }}>
              <ReplayRounded fontSize="small" />
            </IconButton>
          ) : (
            <>
              <IconButton
                size="small"
                aria-label="Double speed"
                aria-pressed={speed === 2}
                className={clsx(speed === 2 && s.active)}
                onClick={() => setSpeed(speed === 2 ? 1 : 2)}>
                <FastForwardRounded fontSize="small" />
              </IconButton>
              <IconButton
                size="small"
                aria-label="Skip to the end"
                onClick={() => setStep(events.length)}>
                <SkipNextRounded fontSize="small" />
              </IconButton>
            </>
          )}
        </div>
      </div>
    </>
  );
}
