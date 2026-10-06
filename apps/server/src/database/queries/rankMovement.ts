import { statisticsFor } from "../listeningDuration";
import { User } from "../schemas/user";
import { basicMatch, getTrackSortType } from "./statsTools";

export type RankMovementKind = "songs" | "albums" | "artists";

const DAY = 86_400_000;
const MINIMUM_RANGE = 14 * DAY;
const MAXIMUM_LOOKBACK = 365 * DAY;
const ROWS = 100;

interface Totals {
  _id: string;
  value: number;
  before: number;
  playedBefore: number;
}

// Standings are compared with a quarter of the range earlier, at most a year.
export function movementReference(start: Date, end: Date, now = Date.now()) {
  const last = Math.min(end.getTime(), now);
  const range = last - start.getTime();
  if (!(range >= MINIMUM_RANGE)) return null;
  return new Date(last - Math.min(range / 4, MAXIMUM_LOOKBACK));
}

// Same order as the top lists: highest total first, then binary ID order.
const byTotal = (key: "value" | "before") => (a: Totals, b: Totals) =>
  b[key] - a[key] || (a._id < b._id ? -1 : a._id > b._id ? 1 : 0);

/** Places gained since the reference; null marks an entry without one. */
export function rankMovement(rows: Totals[], limit = ROWS) {
  const earlier = new Map(
    rows
      .filter((row) => row.playedBefore > 0)
      .sort(byTotal("before"))
      .map((row, index) => [row._id, index]),
  );
  return rows
    .filter((row) => row.value > 0)
    .sort(byTotal("value"))
    .slice(0, limit)
    .map((row, index) => ({
      id: row._id,
      change: earlier.has(row._id) ? earlier.get(row._id)! - index : null,
    }));
}

export async function getRankMovement(
  user: User,
  start: Date,
  end: Date,
  kind: RankMovementKind,
) {
  const since = movementReference(start, end);
  if (!since) return { since: null, items: [] };
  const field = (
    { songs: "$id", albums: "$albumId", artists: "$primaryArtistId" } as const
  )[kind];
  const value = getTrackSortType(user) === "count" ? 1 : "$durationMs";
  const before = { $lt: ["$played_at", since] };
  const rows = await statisticsFor(user)
    .aggregate<Totals>([
      ...basicMatch(user._id, start, end),
      {
        $group: {
          _id: field,
          value: { $sum: value },
          before: { $sum: { $cond: [before, value, 0] } },
          playedBefore: { $sum: { $cond: [before, 1, 0] } },
        },
      },
      { $match: { _id: { $type: "string" } } },
    ])
    .option({ maxTimeMS: 15_000, allowDiskUse: true });
  return { since, items: rankMovement(rows) };
}
