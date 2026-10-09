import { useCallback, useId, useState } from "react";
import { Link } from "react-router-dom";

import { RequestState } from "../../../components/ListeningPatterns/shared";
import { seriesColor } from "../../../components/ListeningTimeline/TimelineChart";
import TitleCard from "../../../components/TitleCard";
import { api } from "../../../services/apis/api";
import { useListeningRequest } from "../../../services/hooks/hooks";
import {
  formatShare,
  overlapDistance,
  TasteOverlap as TasteOverlapData,
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

function Venn({
  data,
  active,
  preview,
  select,
}: {
  data: TasteOverlapData;
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

function regionTitle(data: TasteOverlapData, members: number[]) {
  const names = members.map((person) => data.people[person]!.name);
  return members.length === 1 ? `Only ${names[0]}` : names.join(" & ");
}

export default function TasteOverlap({
  userIds,
  start,
  end,
}: {
  userIds: string[];
  start: number;
  end: number;
}) {
  const request = useCallback(
    () => api.getTasteOverlap(userIds, new Date(start), new Date(end)),
    [userIds, start, end],
  );
  const { data, error, retry } = useListeningRequest(request);
  const [selected, setSelected] = useState<number>();
  const [previewed, setPreviewed] = useState<number>();
  if (data === null) return null;
  const active = previewed ?? selected ?? (data ? data.regions.length - 1 : 0);
  const region = data?.regions[active];
  return (
    <TitleCard title="Taste overlap" contentClassName={s.chartContent}>
      {!data || !region ? (
        <RequestState error={error} retry={retry} />
      ) : (
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
            <ol className={s.overlapArtists}>
              {region.artists.map((artist) => (
                <li key={artist.id}>
                  {artist.image ? (
                    <img src={artist.image} alt="" loading="lazy" />
                  ) : (
                    <span className={s.overlapNoImage} />
                  )}
                  <Link to={`/artist/${artist.id}`} title={artist.name}>
                    {artist.name}
                  </Link>
                  <span>{formatShare(artist.share, 1)}</span>
                </li>
              ))}
            </ol>
          </div>
        </div>
      )}
    </TitleCard>
  );
}
