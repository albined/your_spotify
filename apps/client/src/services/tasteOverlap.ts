import type { TopTimelineKind } from "./listeningTimeline";

// A song, album or artist that a race can be run for.
export interface OverlapItem {
  id: string;
  name: string;
  // The credited artists of a song or album.
  subtitle?: string;
  image?: string;
}

export interface TasteOverlap {
  people: { id: string; name: string }[];
  // Present when two or three people all have listening to compare.
  regions:
    | {
        // Indexes into people; a region belongs to exactly these people.
        members: number[];
        share: number;
        items: (OverlapItem & { share: number })[];
      }[]
    | null;
  // The most shared first.
  items: OverlapItem[];
}

// The region shown before one is chosen: the most people who have something
// in common, and of those the one where it is most.
export function widestRegion(regions: NonNullable<TasteOverlap["regions"]>) {
  let widest = regions.length - 1;
  regions.forEach((region, index) => {
    const best = regions[widest]!;
    if (
      region.items.length &&
      (!best.items.length ||
        region.members.length > best.members.length ||
        (region.members.length === best.members.length &&
          region.share > best.share))
    )
      widest = index;
  });
  return widest;
}

export const overlapKinds: {
  kind: TopTimelineKind;
  label: string;
  one: string;
}[] = [
  { kind: "artists", label: "Artists", one: "Artist" },
  { kind: "albums", label: "Albums", one: "Album" },
  { kind: "songs", label: "Songs", one: "Song" },
];

// Distance between two equal circles whose lens covers `share` of each.
export function overlapDistance(share: number, radius: number) {
  const lens = (distance: number) => {
    const half = distance / (2 * radius);
    return (2 / Math.PI) * (Math.acos(half) - half * Math.sqrt(1 - half ** 2));
  };
  let near = 0;
  let far = 2 * radius;
  for (let step = 0; step < 40; step += 1) {
    const middle = (near + far) / 2;
    if (lens(middle) > share) near = middle;
    else far = middle;
  }
  return (near + far) / 2;
}

export const formatShare = (share: number, digits = 0) => {
  const percent = share * 100;
  const smallest = 10 ** -digits;
  if (percent > 0 && percent < smallest) return `<${smallest}%`;
  return `${percent.toFixed(digits)}%`;
};
