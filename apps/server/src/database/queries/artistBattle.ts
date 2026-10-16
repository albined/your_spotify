import { Types } from "mongoose";

import {
  ArtistDay,
  battle,
  DAY_MS,
  drafts,
  LOYALTY_DAYS,
  RECENT_DAYS,
  Side,
} from "../../tools/battle";
import { statisticsFor } from "../listeningDuration";
import { SpotifyImage } from "../schemas/types";
import { requireCompetitionParticipants } from "./competitionParticipants";
import { getItemDetails } from "./listeningItems";

const INGESTION_MARGIN = 15 * 60 * 1000;

const dayOf = (date: Date) => Math.floor(date.getTime() / DAY_MS);
const isoDay = (day: number) =>
  new Date(day * DAY_MS).toISOString().slice(0, 10);

// The smallest picture that still looks sharp as a fighter's head.
function portrait(images: SpotifyImage[]) {
  const sorted = [...images].sort((a, b) => (a.width ?? 0) - (b.width ?? 0));
  return (sorted.find((image) => (image.width ?? 0) >= 160) ?? sorted.at(-1))
    ?.url;
}

/**
 * The battle of one UTC day between two people, with the results of every
 * other day of that month so far. Battles never depend on who is looking:
 * the people are ordered by ID, and the viewer's own duration setting and
 * the day's own listening are left out.
 */
export async function getArtistBattle(
  userIds: string[],
  day?: string,
  now = new Date(),
) {
  const accounts = (await requireCompetitionParticipants(userIds)).sort(
    (a, b) => (a._id.toHexString() < b._id.toHexString() ? -1 : 1),
  );
  const ids = accounts.map((account) => account._id.toHexString());
  // Plays arrive a few minutes late, so a day's battle starts once the plays
  // of the day before are in.
  const today = dayOf(new Date(now.getTime() - INGESTION_MARGIN));
  const wanted = day
    ? Math.min(today, dayOf(new Date(`${day}T00:00:00Z`)))
    : today;
  const date = new Date(wanted * DAY_MS);
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  const first = dayOf(new Date(Date.UTC(year, month, 1)));
  const last = Math.min(
    today,
    dayOf(new Date(Date.UTC(year, month + 1, 1))) - 1,
  );
  const recentFrom = new Date((first - RECENT_DAYS) * DAY_MS);
  const grouped = await statisticsFor()
    .aggregate<{
      _id: { owner: Types.ObjectId; artist: string; day: string };
      duration: number;
      songs: string[];
    }>([
      {
        $match: {
          owner: { $in: accounts.map((account) => account._id) },
          played_at: {
            $gte: new Date((first - LOYALTY_DAYS) * DAY_MS),
            $lt: new Date(last * DAY_MS),
          },
          blacklistedBy: { $exists: false },
          primaryArtistId: { $type: "string", $ne: "" },
          durationMs: {
            $type: "number",
            $gt: 0,
            $lte: Number.MAX_SAFE_INTEGER,
          },
        },
      },
      {
        $group: {
          _id: {
            owner: "$owner",
            artist: "$primaryArtistId",
            day: {
              $dateToString: {
                date: "$played_at",
                format: "%Y-%m-%d",
                timezone: "UTC",
              },
            },
          },
          duration: { $sum: "$durationMs" },
          // Only the 30 days before a battle count songs.
          songs: {
            $addToSet: {
              $cond: [{ $gte: ["$played_at", recentFrom] }, "$id", "$$REMOVE"],
            },
          },
        },
      },
    ])
    .option({ maxTimeMS: 15_000, allowDiskUse: true });
  const rows: ArtistDay[] = grouped.map((row) => ({
    person: ids.indexOf(row._id.owner.toHexString()) as Side,
    artist: row._id.artist,
    day: dayOf(new Date(`${row._id.day}T00:00:00Z`)),
    duration: row.duration,
    songs: row.songs,
  }));
  const days: { day: string; winner: Side | null }[] = [];
  const results = new Map<number, NonNullable<ReturnType<typeof battle>>>();
  for (const [current, teams] of drafts(rows, first, last)) {
    const result = battle(teams, `${isoDay(current)}:${ids.join(":")}`);
    if (!result) continue;
    days.push({ day: isoDay(current), winner: result.winner });
    results.set(current, result);
  }
  // A day without a battle shows the closest one of the month, earlier first.
  const fought = [...results.keys()];
  const shown = results.has(wanted)
    ? wanted
    : (fought.filter((item) => item < wanted).at(-1) ??
      fought.find((item) => item > wanted));
  const chosen = shown === undefined ? undefined : results.get(shown);
  const people = accounts.map((account, index) => ({
    id: ids[index]!,
    name: account.username,
  }));
  if (!chosen || shown === undefined) return { people, days, battle: null };
  const details = await getItemDetails(
    "artists",
    chosen.teams.flat().map((fighter) => fighter.id),
  );
  return {
    people,
    days,
    battle: {
      day: isoDay(shown),
      winner: chosen.winner,
      events: chosen.events,
      teams: chosen.teams.map((team) =>
        team.map((fighter) => {
          const { name, images } = details(fighter.id);
          return { ...fighter, name, image: portrait(images) };
        }),
      ),
    },
  };
}
