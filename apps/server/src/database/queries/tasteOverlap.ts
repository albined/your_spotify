import { Types } from "mongoose";

import { statisticsFor } from "../listeningDuration";
import { User } from "../schemas/user";
import { requireCompetitionParticipants } from "./competitionParticipants";
import { getItemDetails, itemField, ItemKind } from "./listeningItems";

const REGION_ITEMS = 12;
const COMMON_ITEMS = 200;

interface Listening {
  item: string;
  person: number;
  duration: number;
}

// How much of each person's listening every item takes up.
function itemShares(people: number, rows: Listening[]) {
  const totals = Array<number>(people).fill(0);
  for (const row of rows) totals[row.person]! += row.duration;
  const shares = new Map<string, number[]>();
  for (const row of rows) {
    if (!(totals[row.person]! > 0)) continue;
    const share = shares.get(row.item) ?? Array<number>(people).fill(0);
    share[row.person]! += row.duration / totals[row.person]!;
    shares.set(row.item, share);
  }
  return { totals, shares };
}

/**
 * Splits each person's listening into the regions of a Venn diagram. An
 * item's share of someone's listening counts as shared up to the smallest
 * share among the people in a region, so every person's regions add up to 1.
 * Returns null when someone has no listening to compare.
 */
export function tasteOverlap(
  people: number,
  rows: Listening[],
  limit = REGION_ITEMS,
) {
  const { totals, shares } = itemShares(people, rows);
  if (totals.some((total) => !(total > 0))) return null;
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
      items: items
        .sort((a, b) => b.share - a.share || (a.id < b.id ? -1 : 1))
        .slice(0, limit),
    }));
}

/**
 * Ranks what the people have in common. An item counts for as much as the
 * person it matters least to, and nothing when one of them never plays it;
 * those follow in order of what it takes up for everyone together.
 */
export function commonItems(
  people: number,
  rows: Listening[],
  limit = COMMON_ITEMS,
) {
  return [...itemShares(people, rows).shares]
    .map(([id, share]) => ({
      id,
      share: Math.min(...share),
      combined: share.reduce((sum, value) => sum + value, 0),
    }))
    .sort(
      (a, b) =>
        b.share - a.share || b.combined - a.combined || (a.id < b.id ? -1 : 1),
    )
    .slice(0, limit)
    .map(({ id, share }) => ({ id, share }));
}

export async function getTasteOverlap(
  user: User,
  userIds: string[],
  start: Date,
  end: Date,
  kind: ItemKind = "artists",
) {
  const accounts = await requireCompetitionParticipants(userIds);
  const ids = accounts.map((account) => account._id.toHexString());
  const field = itemField[kind];
  const grouped = await statisticsFor(user)
    .aggregate<{
      _id: { item: string; owner: Types.ObjectId };
      duration: number;
    }>([
      {
        $match: {
          owner: { $in: accounts.map((account) => account._id) },
          played_at: { $gte: start, $lt: end },
          blacklistedBy: { $exists: false },
          [field]: { $type: "string", $ne: "" },
          durationMs: {
            $type: "number",
            $gt: 0,
            $lte: Number.MAX_SAFE_INTEGER,
          },
        },
      },
      {
        $group: {
          _id: { item: `$${field}`, owner: "$owner" },
          duration: { $sum: "$durationMs" },
        },
      },
    ])
    .option({ maxTimeMS: 15_000, allowDiskUse: true });
  const rows = grouped.map((row) => ({
    item: row._id.item,
    person: ids.indexOf(row._id.owner.toHexString()),
    duration: row.duration,
  }));
  // A Venn diagram of more than three people cannot be read.
  const regions =
    ids.length === 2 || ids.length === 3
      ? tasteOverlap(ids.length, rows)
      : null;
  const common = commonItems(ids.length, rows);
  const details = await getItemDetails(kind, [
    ...new Set(
      [...common, ...(regions ?? []).flatMap((region) => region.items)].map(
        ({ id }) => id,
      ),
    ),
  ]);
  const describe = <T extends { id: string }>(item: T) => {
    const { name, subtitle, images } = details(item.id);
    return {
      ...item,
      name,
      // Artists have no credits; a song or album always has the field.
      ...(subtitle === undefined ? {} : { subtitle }),
      image: images.at(-1)?.url,
    };
  };
  return {
    people: accounts.map((account, index) => ({
      id: ids[index]!,
      name: account.username,
    })),
    regions:
      regions?.map((region) => ({
        ...region,
        items: region.items.map(describe),
      })) ?? null,
    // Everything a race can be run for, the most shared first.
    items: common.map(({ id }) => describe({ id })),
  };
}
