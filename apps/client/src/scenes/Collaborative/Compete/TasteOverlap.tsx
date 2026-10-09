import clsx from "clsx";
import { useId, useState } from "react";

import { seriesColor } from "../../../components/ListeningTimeline/TimelineChart";
import {
  formatShare,
  overlapDistance,
  TasteOverlap as TasteOverlapData,
  widestRegion,
} from "../../../services/tasteOverlap";

import s from "./index.module.css";

const WIDTH = 340;
const HEIGHT = 260;
const CENTER = { x: WIDTH / 2, y: HEIGHT / 2 };

interface Point {
  x: number;
  y: number;
}

interface Layout {
  radius: number;
  circles: Point[];
  names: (Point & { anchor: "start" | "middle" | "end" })[];
  // Where a region's percentage is written, when there is room for it.
  label: (members: number[]) => Point | null;
}

// Each circle is all of one person's listening, so the lens is drawn to scale.
function pairLayout(shared: number): Layout {
  const radius = 84;
  const distance = overlapDistance(shared, radius);
  const circles = [-1, 1].map((side) => ({
    x: CENTER.x + (side * distance) / 2,
    y: CENTER.y,
  }));
  return {
    radius,
    circles,
    names: [
      { x: circles[0]!.x - radius, y: 30, anchor: "start" },
      { x: circles[1]!.x + radius, y: HEIGHT - 22, anchor: "end" },
    ],
    label: (members) => {
      if (members.length === 2)
        return 2 * radius - distance < 36 ? null : CENTER;
      if (distance < 36) return null;
      const side = members[0] === 0 ? -1 : 1;
      return { x: CENTER.x + side * radius, y: CENTER.y };
    },
  };
}

// Three circles cannot be drawn to scale, so the layout is fixed.
function trioLayout(): Layout {
  const radius = 66;
  const spread = 40;
  const center = { x: CENTER.x, y: CENTER.y + 10 };
  const directions = [-90, 150, 30].map((degrees) => ({
    x: Math.cos((degrees * Math.PI) / 180),
    y: Math.sin((degrees * Math.PI) / 180),
  }));
  const from = (direction: Point, distance: number) => ({
    x: center.x + direction.x * distance,
    y: center.y + direction.y * distance,
  });
  const circles = directions.map((direction) => from(direction, spread));
  return {
    radius,
    circles,
    names: [
      { x: center.x, y: circles[0]!.y - radius - 12, anchor: "middle" },
      { x: circles[1]!.x - radius, y: HEIGHT - 8, anchor: "start" },
      { x: circles[2]!.x + radius, y: HEIGHT - 8, anchor: "end" },
    ],
    label: (members) => {
      if (members.length === 3) return center;
      if (members.length === 1)
        return from(directions[members[0]!]!, spread + radius * 0.5);
      const other = [0, 1, 2].find((person) => !members.includes(person))!;
      return from(directions[other]!, -42);
    },
  };
}

interface Overlap {
  people: TasteOverlapData["people"];
  regions: NonNullable<TasteOverlapData["regions"]>;
}

function Venn({
  data,
  active,
  preview,
  select,
}: {
  data: Overlap;
  active: number;
  preview: (region?: number) => void;
  select: (region: number) => void;
}) {
  const id = useId().replace(/:/g, "");
  const everyone = data.regions.at(-1)!;
  const layout =
    data.people.length === 2 ? pairLayout(everyone.share) : trioLayout();
  return (
    <svg
      className={s.venn}
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      role="group"
      aria-label="Taste overlap">
      <defs>
        {layout.circles.map((circle, person) => (
          <clipPath key={person} id={`${id}-in-${person}`}>
            <circle cx={circle.x} cy={circle.y} r={layout.radius} />
          </clipPath>
        ))}
        {data.regions.map((region, index) => (
          <mask key={index} id={`${id}-only-${index}`}>
            <rect width={WIDTH} height={HEIGHT} fill="white" />
            {layout.circles.map(
              (circle, person) =>
                !region.members.includes(person) && (
                  <circle
                    key={person}
                    cx={circle.x}
                    cy={circle.y}
                    r={layout.radius}
                    fill="black"
                  />
                ),
            )}
          </mask>
        ))}
      </defs>
      {layout.circles.map((circle, person) => (
        <circle
          key={person}
          cx={circle.x}
          cy={circle.y}
          r={layout.radius}
          fill={seriesColor(person)}
          fillOpacity={0.3}
          stroke={seriesColor(person)}
          strokeWidth={1.5}
        />
      ))}
      {/* Later regions have more members and sit on top, so each point is
          claimed by the region with the most people in it. */}
      {data.regions.map((region, index) => {
        const [first, ...rest] = region.members as [number, ...number[]];
        const shape = rest.reduce(
          (node, person) => <g clipPath={`url(#${id}-in-${person})`}>{node}</g>,
          <circle
            cx={layout.circles[first]!.x}
            cy={layout.circles[first]!.y}
            r={layout.radius}
          />,
        );
        return (
          <g
            key={index}
            className={s.region}
            mask={`url(#${id}-only-${index})`}
            role="button"
            tabIndex={0}
            aria-label={`${regionTitle(data, region.members)}, ${formatShare(region.share)}`}
            aria-pressed={index === active}
            data-active={index === active}
            onMouseEnter={() => preview(index)}
            onMouseLeave={() => preview()}
            onFocus={() => preview(index)}
            onBlur={() => preview()}
            onClick={() => select(index)}
            onKeyDown={(event) => {
              if (event.key !== "Enter" && event.key !== " ") return;
              event.preventDefault();
              select(index);
            }}>
            {shape}
          </g>
        );
      })}
      {data.regions.map((region, index) => {
        const point = layout.label(region.members);
        return (
          point && (
            <text
              key={index}
              className={s.share}
              x={point.x}
              y={point.y}
              data-active={index === active}>
              {formatShare(region.share)}
            </text>
          )
        );
      })}
      {data.people.map((person, index) => (
        <text
          key={person.id}
          className={s.person}
          x={layout.names[index]!.x}
          y={layout.names[index]!.y}
          textAnchor={layout.names[index]!.anchor}
          fill={seriesColor(index)}>
          {person.name.length > 18
            ? `${person.name.slice(0, 17)}…`
            : person.name}
        </text>
      ))}
    </svg>
  );
}

function regionTitle(data: Overlap, members: number[]) {
  const names = members.map((person) => data.people[person]!.name);
  return members.length === 1 ? `Only ${names[0]}` : names.join(" & ");
}

// The diagram and the list of what its chosen region holds. Picking from the
// list is how the page chooses what the race below is run for.
export default function TasteOverlap({
  people,
  regions,
  round,
  pickedId,
  pick,
}: Overlap & {
  // Artists are shown round, covers square.
  round: boolean;
  pickedId: string;
  pick: (id: string) => void;
}) {
  const [selected, setSelected] = useState<number>();
  const [previewed, setPreviewed] = useState<number>();
  const data = { people, regions };
  const active = previewed ?? selected ?? widestRegion(regions);
  const region = regions[active];
  if (!region) return null;
  return (
    <div className={s.overlap}>
      <Venn
        data={data}
        active={active}
        preview={setPreviewed}
        select={setSelected}
      />
      <div className={s.overlapDetail} aria-live="polite">
        <div className={s.overlapTitle}>
          <strong>{regionTitle(data, region.members)}</strong>
          <span>{formatShare(region.share)}</span>
        </div>
        <ol className={clsx(s.overlapItems, round && s.round)}>
          {region.items.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                aria-pressed={item.id === pickedId}
                title={
                  item.subtitle ? `${item.name} · ${item.subtitle}` : item.name
                }
                onClick={() => pick(item.id)}>
                {item.image ? (
                  <img src={item.image} alt="" loading="lazy" />
                ) : (
                  <span className={s.overlapNoImage} />
                )}
                <span className={s.overlapName}>
                  <span>{item.name}</span>
                  {item.subtitle && <small>{item.subtitle}</small>}
                </span>
                <span>{formatShare(item.share, 1)}</span>
              </button>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
