export type BattleClass = "knight" | "cleric" | "wizard" | "rogue";
export type BattleSide = 0 | 1;
export type BattleSlot = [BattleSide, number];

export interface BattleFighter {
  id: string;
  name: string;
  image?: string;
  class: BattleClass;
  // What hit points and attack were multiplied by.
  scale: number;
  hp: number;
  attack: number;
  speed: number;
  // Of the owner's listening in the 30 days before the battle.
  share: number;
  loyaltyDays: number;
  recentDays: number;
  songs: number;
  contested: boolean;
}

export interface BattleHit {
  target: BattleSlot;
  amount: number;
  // Hit points left after it.
  hp: number;
  crit?: true;
  miss?: true;
  ko?: true;
}

export interface BattleEvent {
  actor: BattleSlot;
  action: "slash" | "stab" | "charge" | "spell" | "heal" | "smite";
  hits: BattleHit[];
}

export interface ArtistBattle {
  // Ordered by ID, so a battle looks the same from either side.
  people: { id: string; name: string }[];
  // The days of the month so far that had a battle; null is a draw.
  days: { day: string; winner: BattleSide | null }[];
  battle: {
    day: string;
    winner: BattleSide | null;
    teams: [BattleFighter[], BattleFighter[]];
    events: BattleEvent[];
  } | null;
}
