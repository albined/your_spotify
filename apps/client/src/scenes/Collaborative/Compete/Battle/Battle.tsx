import ChevronLeftRounded from "@mui/icons-material/ChevronLeftRounded";
import ChevronRightRounded from "@mui/icons-material/ChevronRightRounded";
import { IconButton, ToggleButton, ToggleButtonGroup } from "@mui/material";
import { useCallback, useMemo, useState } from "react";
import { useSelector } from "react-redux";

import { RequestState } from "../../../../components/ListeningPatterns/shared";
import { seriesColor } from "../../../../components/ListeningTimeline/TimelineChart";
import TitleCard from "../../../../components/TitleCard";
import { api } from "../../../../services/apis/api";
import { ArtistBattle, BattleSide } from "../../../../services/battle";
import { useListeningRequest } from "../../../../services/hooks/hooks";
import { selectUser } from "../../../../services/redux/modules/user/selector";
import Arena from "./Arena";
import Scoreboard from "./Scoreboard";

import s from "./index.module.css";

const isoDay = (date: Date) => date.toISOString().slice(0, 10);
// The server starts a day's battle a quarter of an hour late.
const battleToday = () => isoDay(new Date(Date.now() - 15 * 60 * 1000));
const utc = (day: string) => new Date(`${day}T00:00:00Z`);

// Battles this browser has played to the end, so they open on their result.
const WATCHED = "battle-watched";
const readWatched = (): string[] => {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(WATCHED) ?? "[]");
    return Array.isArray(stored)
      ? stored.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
};
const saveWatched = (watched: string[]) => {
  try {
    localStorage.setItem(WATCHED, JSON.stringify(watched.slice(-500)));
  } catch {
    // Without storage, a battle is remembered until the page is left.
  }
};

function Month({
  data,
  day,
  hidden,
  colors,
  select,
}: {
  data: ArtistBattle;
  day: string;
  // A battle that has not been watched yet keeps its result to itself.
  hidden?: string;
  colors: string[];
  select: (day: string) => void;
}) {
  const shown = utc(day);
  const year = shown.getUTCFullYear();
  const month = shown.getUTCMonth();
  const today = battleToday();
  const length = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const results = new Map(
    data.days.map((item) => [
      item.day,
      item.day === hidden ? undefined : item.winner,
    ]),
  );
  const days = Array.from({ length }, (_, index) =>
    isoDay(new Date(Date.UTC(year, month, index + 1))),
  ).filter((item) => item <= today);
  const next = isoDay(new Date(Date.UTC(year, month + 1, 1)));
  const label = (item: string) =>
    utc(item).toLocaleDateString(undefined, {
      day: "numeric",
      month: "short",
      timeZone: "UTC",
    });
  return (
    <div className={s.month}>
      <IconButton
        size="small"
        aria-label="Previous month"
        onClick={() => select(isoDay(new Date(Date.UTC(year, month, 0))))}>
        <ChevronLeftRounded fontSize="small" />
      </IconButton>
      <span className={s.monthName}>
        {shown.toLocaleDateString(undefined, {
          month: "short",
          ...(today.startsWith(String(year)) ? {} : { year: "numeric" }),
          timeZone: "UTC",
        })}
      </span>
      <IconButton
        size="small"
        aria-label="Next month"
        disabled={next > today}
        onClick={() =>
          select(today.startsWith(next.slice(0, 7)) ? today : next)
        }>
        <ChevronRightRounded fontSize="small" />
      </IconButton>
      <div className={s.days}>
        {days.map((item) => {
          const fought = results.has(item);
          const winner = results.get(item);
          return (
            <button
              key={item}
              type="button"
              className={s.day}
              disabled={!fought}
              aria-pressed={item === day}
              aria-label={label(item)}
              title={
                fought && winner !== undefined
                  ? `${label(item)} · ${winner === null ? "Draw" : data.people[winner]?.name}`
                  : label(item)
              }
              style={
                fought && winner !== null && winner !== undefined
                  ? { background: colors[winner] }
                  : undefined
              }
              onClick={() => select(item)}
            />
          );
        })}
      </div>
    </div>
  );
}

function PairBattle({
  pair,
  colorOf,
  picker,
}: {
  pair: string[];
  colorOf: (id: string) => string;
  picker?: React.ReactNode;
}) {
  const user = useSelector(selectUser);
  const [day, setDay] = useState<string>();
  const request = useCallback(
    () => api.getArtistBattle(pair, day),
    [pair, day],
  );
  const { data, error, retry } = useListeningRequest(request);
  // A new day is fetched while the one on screen stays.
  const [shown, setShown] = useState<ArtistBattle>();
  if (data && data !== shown) setShown(data);
  const [watched, setWatched] = useState(readWatched);
  const battle = shown?.battle;
  const watchKey =
    battle &&
    `${user?._id}>${shown.people.map((person) => person.id).join()}:${battle.day}`;
  const reveal = useCallback(() => {
    if (!watchKey) return;
    setWatched((keys) => {
      if (keys.includes(watchKey)) return keys;
      const next = [
        ...readWatched().filter((key) => key !== watchKey),
        watchKey,
      ];
      saveWatched(next);
      return next;
    });
  }, [watchKey]);
  if (shown && !shown.battle && !shown.days.length && !day && !picker)
    return null;
  const colors = shown?.people.map((person) => colorOf(person.id)) ?? [];
  const names = shown?.people.map((person) => person.name) ?? [];
  const viewer = shown?.people.findIndex((person) => person.id === user?._id);
  const left = (viewer === 1 ? 1 : 0) as BattleSide;
  const hidden =
    battle && watchKey && !watched.includes(watchKey) ? battle.day : undefined;
  const wins = ([0, 1] as const).map(
    (side) =>
      shown?.days.filter((item) => item.winner === side && item.day !== hidden)
        .length ?? 0,
  );
  const current = battle?.day ?? day ?? battleToday();
  return (
    <TitleCard title="Battle" right={picker}>
      {!shown ? (
        <RequestState error={error} retry={retry} />
      ) : (
        <>
          {battle ? (
            <Arena
              key={`${pair.join()}:${battle.day}`}
              battle={battle}
              names={names}
              colors={colors}
              left={left}
              wins={wins}
              seen={!hidden}
              onDone={reveal}
            />
          ) : (
            <Scoreboard
              names={names}
              colors={colors}
              wins={wins}
              left={left}
              day={current}
            />
          )}
          <Month
            data={shown}
            day={current}
            hidden={hidden}
            colors={colors}
            select={setDay}
          />
          {error && <RequestState error retry={retry} />}
        </>
      )}
    </TitleCard>
  );
}

// Two people fight once a day. With more selected, the viewer picks whom to
// watch them fight.
export default function Battle({
  userIds,
  people,
}: {
  userIds: string[];
  people: { id: string; name: string }[];
}) {
  const user = useSelector(selectUser);
  const viewer = user?._id;
  const pairs = useMemo(() => {
    if (viewer && userIds.includes(viewer))
      return userIds.filter((id) => id !== viewer).map((id) => [viewer, id]);
    return userIds.flatMap((first, index) =>
      userIds.slice(index + 1).map((second) => [first, second]),
    );
  }, [userIds, viewer]);
  const [chosen, setChosen] = useState<string>();
  const pair = pairs.find((item) => item.join() === chosen) ?? pairs[0];
  if (!pair) return null;
  const name = (id: string) =>
    people.find((person) => person.id === id)?.name ?? "";
  const picker = pairs.length > 1 && (
    <ToggleButtonGroup
      size="small"
      exclusive
      value={pair.join()}
      aria-label="Battle between"
      onChange={(_, value: string | null) => {
        if (value !== null) setChosen(value);
      }}>
      {pairs.map((item) => (
        <ToggleButton key={item.join()} value={item.join()}>
          {item[0] === viewer
            ? name(item[1]!)
            : `${name(item[0]!)} – ${name(item[1]!)}`}
        </ToggleButton>
      ))}
    </ToggleButtonGroup>
  );
  return (
    <PairBattle
      key={pair.join()}
      pair={pair}
      colorOf={(id) => seriesColor(userIds.indexOf(id))}
      picker={picker}
    />
  );
}
