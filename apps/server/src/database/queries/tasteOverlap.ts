import { Types } from "mongoose";

import { statisticsFor } from "../listeningDuration";
import { User } from "../schemas/user";
import { getStatisticsArtists } from "./artistGroups";
import { requireCompetitionParticipants } from "./competitionParticipants";

const ARTISTS = 12;

interface Listening {
  artist: string;
  person: number;
  duration: number;
}

/**
 * Splits each person's listening into the regions of a Venn diagram. An
 * artist's share of someone's listening counts as shared up to the smallest
 * share among the people in a region, so every person's regions add up to 1.
 * Returns null when someone has no listening to compare.
 */
export function tasteOverlap(
  people: number,
  rows: Listening[],
  limit = ARTISTS,
) {
  const totals = Array<number>(people).fill(0);
  for (const row of rows) totals[row.person]! += row.duration;
  if (totals.some((total) => !(total > 0))) return null;
  const shares = new Map<string, number[]>();
  for (const row of rows) {
    const share = shares.get(row.artist) ?? Array<number>(people).fill(0);
    share[row.person]! += row.duration / totals[row.person]!;
    shares.set(row.artist, share);
  }
  const regions = new Map<number, { id: string; share: number }[]>();
  for (const [id, share] of shares) {
    const order = share.map((_, person) => person);
    order.sort((a, b) => share[b]! - share[a]! || a - b);
    let mask = 0;
    order.forEach((person, index) => {
      mask |= 1 << person;
      const part = share[person]! - (share[order[index + 1]!] ?? 0);
      if (!(part > 0)) return;
      const items = regions.get(mask) ?? [];
      items.push({ id, share: part });
      regions.set(mask, items);
    });
  }
  const everyone = Array.from({ length: people }, (_, person) => person);
  return Array.from({ length: (1 << people) - 1 }, (_, index) => index + 1)
    .map((mask) => ({
      members: everyone.filter((person) => mask & (1 << person)),
      items: regions.get(mask) ?? [],
    }))
    .sort((a, b) => a.members.length - b.members.length)
    .map(({ members, items }) => ({
      members,
      share: items.reduce((sum, item) => sum + item.share, 0),
      artists: items
        .sort((a, b) => b.share - a.share || (a.id < b.id ? -1 : 1))
        .slice(0, limit),
    }));
}

export async function getTasteOverlap(
  user: User,
  userIds: string[],
  start: Date,
  end: Date,
) {
  const accounts = await requireCompetitionParticipants(userIds);
  if (accounts.length < 2 || accounts.length > 3) return null;
  const ids = accounts.map((account) => account._id.toHexString());
  const rows = await statisticsFor(user)
    .aggregate<{
      _id: { artist: string; owner: Types.ObjectId };
      duration: number;
    }>([
      {
        $match: {
          owner: { $in: accounts.map((account) => account._id) },
          played_at: { $gte: start, $lt: end },
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
          _id: { artist: "$primaryArtistId", owner: "$owner" },
          duration: { $sum: "$durationMs" },
        },
      },
    ])
    .option({ maxTimeMS: 15_000, allowDiskUse: true });
  const regions = tasteOverlap(
    ids.length,
    rows.map((row) => ({
      artist: row._id.artist,
      person: ids.indexOf(row._id.owner.toHexString()),
      duration: row.duration,
    })),
  );
  if (!regions) return null;
  const metadata = await getStatisticsArtists([
    ...new Set(regions.flatMap((region) => region.artists.map(({ id }) => id))),
  ]);
  const byId = new Map(metadata.map((artist) => [artist.id, artist]));
  return {
    people: accounts.map((account, index) => ({
      id: ids[index]!,
      name: account.username,
    })),
    regions: regions.map((region) => ({
      ...region,
      artists: region.artists.map((artist) => ({
        ...artist,
        name: byId.get(artist.id)?.name ?? "Unknown artist",
        image: byId.get(artist.id)?.images.at(-1)?.url,
      })),
    })),
  };
}
