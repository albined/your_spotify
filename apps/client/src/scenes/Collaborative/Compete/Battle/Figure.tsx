import { useId } from "react";

import { BattleClass } from "../../../../services/battle";

import s from "./index.module.css";

// Drawn facing right in a 100 × 140 box, with the feet at the bottom. The
// artwork head is turned back when the whole figure is mirrored.
export const FIGURE_RATIO = 1.4;

function Gear({ cls, color }: { cls: BattleClass; color: string }) {
  const light = `color-mix(in srgb, ${color}, white 35%)`;
  const dark = `color-mix(in srgb, ${color}, black 35%)`;
  if (cls === "knight")
    return (
      <>
        <g className={s.weapon}>
          <g transform="rotate(32 70 98)">
            <path d="M67 92V50l3.5-8 3.5 8v42z" fill="#e8edf3" />
            <path d="M70.5 46v44" stroke="#a9b3bf" strokeWidth={1.2} />
            <rect x={60} y={90} width={21} height={5} rx={2.5} fill="#d4a72c" />
            <rect
              x={68.5}
              y={95}
              width={4}
              height={9}
              rx={1.5}
              fill="#6b4f2a"
            />
          </g>
        </g>
        <path
          d="M14 84h24v11c0 10-7 16-12 18-5-2-12-8-12-18z"
          fill={light}
          stroke={dark}
          strokeWidth={2}
        />
        <path d="M26 87v22M17 94h18" stroke={dark} strokeWidth={2.5} />
      </>
    );
  if (cls === "wizard")
    return (
      <g className={s.weapon}>
        <path
          d="M74 128 76 54"
          stroke="#7a5532"
          strokeWidth={4}
          strokeLinecap="round"
        />
        <circle className={s.orb} cx={76.5} cy={49} r={7} fill="#8fe3ff" />
        <circle cx={74.5} cy={47} r={2.2} fill="white" opacity={0.85} />
      </g>
    );
  if (cls === "cleric")
    return (
      <>
        <path
          d="M50 79v15M43.5 85h13"
          stroke="#ffd75e"
          strokeWidth={3.5}
          strokeLinecap="round"
        />
        <g className={s.weapon}>
          <path
            d="M74 128 74 60"
            stroke="#c99a2e"
            strokeWidth={4}
            strokeLinecap="round"
          />
          <circle cx={74} cy={54} r={8} fill="#ffd75e" />
          <path
            d="M74 48v12M68 54h12"
            stroke="#fff6d5"
            strokeWidth={2.5}
            strokeLinecap="round"
          />
        </g>
      </>
    );
  return (
    <>
      <path
        className={s.scarf}
        d="M36 82c-8 2-16 8-24 6 6 4 14 4 22-2z"
        fill={color}
      />
      <g className={s.weapon}>
        <path d="M72 100 86 84l2 2-14 16z" fill="#e3e8ef" />
        <rect
          x={67}
          y={98}
          width={9}
          height={4}
          rx={1.5}
          fill="#3b3b44"
          transform="rotate(-48 71 100)"
        />
      </g>
      <path d="M28 102 16 90l-2 2 12 12z" fill="#e3e8ef" />
    </>
  );
}

function Headwear({ cls, color }: { cls: BattleClass; color: string }) {
  const dark = `color-mix(in srgb, ${color}, black 35%)`;
  if (cls === "knight")
    return (
      <>
        <path
          d="M27 30C27 8 60-2 76 20c-12-6-34-6-49 10z"
          fill={color}
          stroke={dark}
          strokeWidth={1.5}
        />
        <path
          d="M38 18l-2-6M48 13l-1-7M58 12l1-7M67 15l3-6"
          stroke={dark}
          strokeWidth={1.5}
          strokeLinecap="round"
        />
      </>
    );
  if (cls === "wizard")
    return (
      <>
        <path d="M30 26C42 18 50 0 66-18 62 0 66 14 72 26z" fill="#3f347d" />
        <path d="M31 25c12-4 30-4 41 0l-1 5c-12-4-28-4-39 0z" fill={color} />
        <ellipse cx={50} cy={29} rx={30} ry={5.5} fill="#3f347d" />
        <path
          d="m60-6 1.6 3.4 3.6.4-2.7 2.4.8 3.6-3.3-1.9-3.3 1.9.8-3.6-2.7-2.4 3.6-.4z"
          fill="#ffd75e"
        />
      </>
    );
  if (cls === "cleric")
    return (
      <ellipse
        className={s.halo}
        cx={50}
        cy={10}
        rx={17}
        ry={4.5}
        fill="none"
        stroke="#ffd75e"
        strokeWidth={3}
      />
    );
  return null;
}

export default function Figure({
  cls,
  color,
  image,
  name,
  mirrored,
}: {
  cls: BattleClass;
  color: string;
  image?: string;
  name: string;
  mirrored: boolean;
}) {
  const id = useId().replace(/:/g, "");
  const dark = `color-mix(in srgb, ${color}, black 35%)`;
  const turned = mirrored ? "translate(100 0) scale(-1 1)" : undefined;
  return (
    <svg
      className={s.figure}
      viewBox="0 -20 100 140"
      style={mirrored ? { transform: "scaleX(-1)" } : undefined}
      aria-hidden>
      <defs>
        <clipPath id={`${id}-head`}>
          <circle cx={50} cy={44} r={25} />
        </clipPath>
      </defs>
      <ellipse className={s.shadow} cx={50} cy={116} rx={24} ry={4} />
      {cls === "rogue" && (
        <path
          d="M80 52C82 26 66 12 48 12c-12 0-22 6-27 16L8 22l10 18c-2 10 0 22 6 30h50z"
          fill={`color-mix(in srgb, ${color}, black 60%)`}
          stroke={color}
          strokeWidth={2}
          strokeLinejoin="round"
        />
      )}
      <rect x={37} y={106} width={11} height={9} rx={4} fill={dark} />
      <rect x={53} y={106} width={11} height={9} rx={4} fill={dark} />
      <rect
        x={32}
        y={70}
        width={36}
        height={40}
        rx={13}
        fill={color}
        stroke={dark}
        strokeWidth={2}
      />
      <rect x={32} y={96} width={36} height={4} fill="rgba(0,0,0,0.22)" />
      <Gear cls={cls} color={color} />
      <circle cx={70} cy={98} r={5} fill={dark} />
      {cls !== "knight" && <circle cx={28} cy={98} r={5} fill={dark} />}
      <circle cx={50} cy={44} r={27} fill={dark} />
      <g transform={turned}>
        {image ? (
          <image
            href={image}
            x={25}
            y={19}
            width={50}
            height={50}
            preserveAspectRatio="xMidYMid slice"
            clipPath={`url(#${id}-head)`}
          />
        ) : (
          <>
            <circle cx={50} cy={44} r={25} fill={color} />
            <text className={s.initial} x={50} y={52} textAnchor="middle">
              {name.slice(0, 1).toUpperCase()}
            </text>
          </>
        )}
      </g>
      <circle
        cx={50}
        cy={44}
        r={25.5}
        fill="none"
        stroke={color}
        strokeWidth={3}
      />
      <Headwear cls={cls} color={color} />
    </svg>
  );
}
