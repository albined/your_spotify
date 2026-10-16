// A daily battle between the artists two people have been listening to. The
// draft and the fight are pure functions of the listening before the battle
// day and of a seed made from the day and the two people, so everyone who
// opens the same battle sees the same fight.

export const DAY_MS = 24 * 60 * 60 * 1000;
export const RECENT_DAYS = 30;
export const LOYALTY_DAYS = 365;
const POOL = 10;
const MAX_ROUNDS = 12;

export type BattleClass = "knight" | "cleric" | "wizard" | "rogue";
export type Side = 0 | 1;

export interface ArtistDay {
  person: Side;
  artist: string;
  // Days since 1970-01-01, UTC.
  day: number;
  duration: number;
  songs: string[];
}

export interface Recruit {
  id: string;
  // Of the owner's listening in the 30 days before the battle.
  share: number;
  // Days with a play in the year before the battle.
  loyaltyDays: number;
  recentDays: number;
  songs: number;
  // The other person played it recently too, and lost it in the draft.
  contested: boolean;
}

export interface Fighter extends Recruit {
  class: BattleClass;
  // What hit points and attack were multiplied by.
  scale: number;
  hp: number;
  attack: number;
  speed: number;
}

export type Slot = [Side, number];

export interface Hit {
  target: Slot;
  amount: number;
  hp: number;
  crit?: true;
  miss?: true;
  ko?: true;
}

export type Action = "slash" | "stab" | "charge" | "spell" | "heal" | "smite";

export interface BattleEvent {
  actor: Slot;
  action: Action;
  hits: Hit[];
}

export function seedOf(text: string) {
  // FNV-1a.
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

// Mulberry32: small, fast and the same on every platform.
export function random(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

interface Standing {
  loyaltyDays: number;
  recent: number;
  recentDays: number;
  // How many recent days each song was played on.
  songs: Map<string, number>;
}

/**
 * The draft of every day from `first` to `last`. Every artist either person
 * played in the 30 days before a battle joins one team; when both played it,
 * it goes to whoever played it on more days over the past year. Both windows
 * slide one day at a time, so a month costs about as much as one draft.
 */
export function* drafts(
  rows: ArtistDay[],
  first: number,
  last: number,
): Generator<[number, [Recruit[], Recruit[]]]> {
  const sorted = [...rows].sort((a, b) => a.day - b.day);
  const standings = new Map<string, Standing>();
  const recentKeys = new Set<string>();
  const totals = [0, 0];
  const recentRows = [0, 0];
  const keyOf = (row: ArtistDay) => `${row.person}:${row.artist}`;
  const standing = (row: ArtistDay) => {
    const key = keyOf(row);
    let entry = standings.get(key);
    if (!entry) {
      entry = { loyaltyDays: 0, recent: 0, recentDays: 0, songs: new Map() };
      standings.set(key, entry);
    }
    return entry;
  };
  const enter = (row: ArtistDay) => {
    const entry = standing(row);
    entry.recent += row.duration;
    entry.recentDays += 1;
    totals[row.person]! += row.duration;
    recentRows[row.person]! += 1;
    for (const song of row.songs)
      entry.songs.set(song, (entry.songs.get(song) ?? 0) + 1);
    recentKeys.add(keyOf(row));
  };
  const leave = (row: ArtistDay) => {
    const entry = standing(row);
    entry.recentDays -= 1;
    recentRows[row.person]! -= 1;
    // Sums return to exactly zero, whatever the rounding on the way.
    entry.recent = entry.recentDays ? entry.recent - row.duration : 0;
    totals[row.person] = recentRows[row.person]
      ? totals[row.person]! - row.duration
      : 0;
    for (const song of row.songs) {
      const count = entry.songs.get(song)! - 1;
      if (count) entry.songs.set(song, count);
      else entry.songs.delete(song);
    }
    if (!entry.recentDays) recentKeys.delete(keyOf(row));
  };
  // Rows enter a window once they are before the day and leave it once they
  // are older than it; each window has its own pair of positions.
  let loyalIn = 0;
  let loyalOut = 0;
  let recentIn = 0;
  let recentOut = 0;
  for (let day = first; day <= last; day += 1) {
    for (; loyalIn < sorted.length && sorted[loyalIn]!.day < day; loyalIn += 1)
      standing(sorted[loyalIn]!).loyaltyDays += 1;
    for (
      ;
      loyalOut < loyalIn && sorted[loyalOut]!.day < day - LOYALTY_DAYS;
      loyalOut += 1
    )
      standing(sorted[loyalOut]!).loyaltyDays -= 1;
    for (
      ;
      recentIn < sorted.length && sorted[recentIn]!.day < day;
      recentIn += 1
    )
      enter(sorted[recentIn]!);
    for (
      ;
      recentOut < recentIn && sorted[recentOut]!.day < day - RECENT_DAYS;
      recentOut += 1
    )
      leave(sorted[recentOut]!);
    const teams: [Recruit[], Recruit[]] = [[], []];
    if (totals[0]! > 0 && totals[1]! > 0) {
      const artists = new Set(
        [...recentKeys].map((key) => key.slice(key.indexOf(":") + 1)),
      );
      for (const artist of artists) {
        const fans = ([0, 1] as const)
          .map((person) => ({
            person,
            entry: standings.get(`${person}:${artist}`),
          }))
          .filter(({ entry }) => entry && entry.recent > 0)
          .map(({ person, entry }) => ({
            person,
            entry: entry!,
            share: entry!.recent / totals[person]!,
          }));
        fans.sort(
          (a, b) =>
            b.entry.loyaltyDays - a.entry.loyaltyDays ||
            b.share - a.share ||
            a.person - b.person,
        );
        // Plays without listening time recruit nobody.
        const owner = fans[0];
        if (!owner) continue;
        teams[owner.person].push({
          id: artist,
          share: owner.share,
          loyaltyDays: owner.entry.loyaltyDays,
          recentDays: owner.entry.recentDays,
          songs: owner.entry.songs.size,
          contested: fans.length > 1,
        });
      }
      for (const team of teams)
        team.sort((a, b) => b.share - a.share || (a.id < b.id ? -1 : 1));
    }
    yield [day, teams];
  }
}

export function draft(rows: ArtistDay[], battleDay: number) {
  return drafts(rows, battleDay, battleDay).next().value![1];
}

const base: Record<BattleClass, { hp: number; attack: number; speed: number }> =
  {
    knight: { hp: 130, attack: 40, speed: 10 },
    cleric: { hp: 95, attack: 18, speed: 9 },
    wizard: { hp: 80, attack: 26, speed: 8 },
    rogue: { hp: 85, attack: 34, speed: 15 },
  };

const classes = Object.values(base);
// A full team of four equally strong fighters.
const TEAM_POWER =
  classes.reduce((sum, item) => sum + item.hp, 0) *
  classes.reduce((sum, item) => sum + item.attack, 0);
// A smaller team needs less, since a spell has fewer targets and nothing is
// lost as fighters fall: measured so that it wins about half of its fights
// against four.
const SIZE_POWER = [0, 0.6, 0.75, 0.95, 1];
// Power held by one fighter is worth more than the same power spread out,
// since the weak soak up blows while the strong one keeps hitting. A team
// whose power sits with one fighter gets this share of the power, measured
// in the same way, and an even team gets all of it.
const CONCENTRATED = 0.64;

/**
 * Four of the most played artists, one per class: the most played leads as
 * the knight, the most loyal heals, the one with the most songs casts and the
 * newest obsession strikes from the shadows.
 */
export function squad(recruits: Recruit[]): Fighter[] {
  const pool = recruits.slice(0, POOL);
  const picked: { recruit: Recruit; class: BattleClass }[] = [];
  const pick = (cls: BattleClass, score: (recruit: Recruit) => number) => {
    let best: Recruit | undefined;
    for (const recruit of pool) {
      if (picked.some((item) => item.recruit === recruit)) continue;
      if (!best || score(recruit) > score(best)) best = recruit;
    }
    if (best) picked.push({ recruit: best, class: cls });
  };
  pick("knight", (recruit) => recruit.share);
  pick("cleric", (recruit) => recruit.loyaltyDays + recruit.share);
  pick("wizard", (recruit) => recruit.songs + recruit.share);
  pick("rogue", (recruit) => recruit.recentDays / recruit.loyaltyDays);
  // Strength grows with the square root of the share, and total hit points
  // times total attack, which decides a straight fight, is scaled to what
  // the size of the team and the spread of its strength allow.
  const weights = picked.map(({ recruit }) => Math.sqrt(recruit.share));
  const sum = (value: (cls: BattleClass) => number) =>
    picked.reduce(
      (total, { class: cls }, index) => total + value(cls) * weights[index]!,
      0,
    );
  // How many of the fighters carry the team, from one of them to all.
  const total = weights.reduce((running, weight) => running + weight, 0);
  const carriers =
    (total * total) /
    weights.reduce((running, weight) => running + weight * weight, 0) /
    picked.length;
  const factor = Math.sqrt(
    (TEAM_POWER *
      SIZE_POWER[picked.length]! *
      (CONCENTRATED + (1 - CONCENTRATED) * carriers ** 2)) /
      (sum((cls) => base[cls].hp) * sum((cls) => base[cls].attack)),
  );
  return picked.map(({ recruit, class: cls }, index) => {
    const scale = factor * weights[index]!;
    return {
      ...recruit,
      class: cls,
      scale: Math.round(scale * 1000) / 1000,
      hp: Math.round(base[cls].hp * scale),
      attack: Math.round(base[cls].attack * scale),
      speed: base[cls].speed,
    };
  });
}

const FRONT: BattleClass[] = ["knight", "rogue"];

export function fight(teams: [Fighter[], Fighter[]], seed: number) {
  const roll = random(seed);
  const hp = teams.map((team) => team.map((fighter) => fighter.hp));
  const alive = (side: Side) =>
    teams[side]
      .map((fighter, slot) => ({ fighter, slot }))
      .filter(({ slot }) => hp[side]![slot]! > 0);
  const choose = <T>(items: T[]) => items[Math.floor(roll() * items.length)]!;
  const events: BattleEvent[] = [];
  const charged = new Set<string>();

  const strike = (
    actor: Fighter,
    side: Side,
    slot: number,
    { crit = 0.1, miss = 0.07, power = 1 } = {},
  ): Hit => {
    const target: Slot = [side, slot];
    if (roll() < miss)
      return { target, amount: 0, hp: hp[side]![slot]!, miss: true };
    const critical = roll() < crit;
    const amount = Math.max(
      1,
      Math.round(
        actor.attack * power * (0.85 + 0.3 * roll()) * (critical ? 1.8 : 1),
      ),
    );
    const left = Math.max(0, hp[side]![slot]! - amount);
    hp[side]![slot] = left;
    return {
      target,
      amount,
      hp: left,
      ...(critical ? { crit: true as const } : {}),
      ...(left === 0 ? { ko: true as const } : {}),
    };
  };

  const act = (side: Side, slot: number): BattleEvent => {
    const actor = teams[side][slot]!;
    const foe = (1 - side) as Side;
    const enemies = alive(foe);
    const key = `${side}:${slot}`;
    if (actor.class === "knight") {
      const front = enemies.filter(({ fighter }) =>
        FRONT.includes(fighter.class),
      );
      const { slot: target } = choose(front.length ? front : enemies);
      return {
        actor: [side, slot],
        action: "slash",
        hits: [strike(actor, foe, target)],
      };
    }
    if (actor.class === "rogue") {
      const weakest = enemies.reduce((best, item) =>
        hp[foe]![item.slot]! < hp[foe]![best.slot]! ? item : best,
      );
      return {
        actor: [side, slot],
        action: "stab",
        hits: [strike(actor, foe, weakest.slot, { crit: 0.3, miss: 0.04 })],
      };
    }
    if (actor.class === "wizard") {
      if (!charged.has(key)) {
        charged.add(key);
        return { actor: [side, slot], action: "charge", hits: [] };
      }
      charged.delete(key);
      return {
        actor: [side, slot],
        action: "spell",
        hits: enemies.map(({ slot: target }) =>
          strike(actor, foe, target, { crit: 0.05, miss: 0.05 }),
        ),
      };
    }
    const hurt = alive(side)
      .map((item) => ({
        ...item,
        left: hp[side]![item.slot]! / item.fighter.hp,
      }))
      .filter((item) => item.left < 0.5)
      .sort((a, b) => a.left - b.left);
    if (hurt.length) {
      const { slot: target, fighter } = hurt[0]!;
      const amount = Math.min(
        fighter.hp - hp[side]![target]!,
        Math.round(actor.attack * 1.2 * (0.85 + 0.3 * roll())),
      );
      hp[side]![target]! += amount;
      return {
        actor: [side, slot],
        action: "heal",
        hits: [{ target: [side, target], amount, hp: hp[side]![target]! }],
      };
    }
    return {
      actor: [side, slot],
      action: "smite",
      hits: [strike(actor, foe, choose(enemies).slot)],
    };
  };

  for (let round = 0; round < MAX_ROUNDS; round += 1) {
    const order = ([0, 1] as const)
      .flatMap((side) =>
        alive(side).map(({ fighter, slot }) => ({
          side,
          slot,
          speed: fighter.speed * (0.75 + 0.5 * roll()),
        })),
      )
      .sort((a, b) => b.speed - a.speed || a.side - b.side || a.slot - b.slot);
    for (const { side, slot } of order) {
      if (!alive(0).length || !alive(1).length) break;
      if (hp[side]![slot]! <= 0) continue;
      events.push(act(side, slot));
    }
    if (!alive(0).length || !alive(1).length) break;
  }
  // Without a knockout, what is left of each team decides, as the bars show.
  const standing = ([0, 1] as const).map(
    (side) =>
      hp[side]!.reduce((sum, value) => sum + value, 0) /
      teams[side].reduce((sum, fighter) => sum + fighter.hp, 0),
  );
  const winner: Side | null =
    standing[0]! > standing[1]! ? 0 : standing[1]! > standing[0]! ? 1 : null;
  return { events, winner };
}

export function battle([first, second]: [Recruit[], Recruit[]], seed: string) {
  if (!first.length || !second.length) return null;
  const teams: [Fighter[], Fighter[]] = [squad(first), squad(second)];
  return { teams, ...fight(teams, seedOf(seed)) };
}
