export interface TasteOverlap {
  people: { id: string; name: string }[];
  regions: {
    // Indexes into people; a region belongs to exactly these people.
    members: number[];
    share: number;
    artists: { id: string; name: string; image?: string; share: number }[];
  }[];
}

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
