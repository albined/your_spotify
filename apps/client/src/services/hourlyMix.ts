import { artistColor } from "./artistDistribution";

export interface HourlyMixData {
  hour: number;
  total: number;
  items: { itemId: string; total: number }[];
  full_items: Record<string, { name: string; images?: { url: string }[] }>;
}

export function buildHourlyMix(data: HourlyMixData[]) {
  const totals = new Map<string, number>();
  for (const hour of data)
    for (const item of hour.items)
      totals.set(item.itemId, (totals.get(item.itemId) ?? 0) + item.total);
  // Keep each item in the same stack order and color throughout the day.
  const order = new Map(
    [...totals]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([id], index) => [id, index]),
  );
  return Array.from({ length: 24 }, (_, hour) => {
    const source = data.find((entry) => entry.hour === hour);
    let bottom = 0;
    const segments = (source?.total ? [...source.items] : [])
      .sort((a, b) => order.get(a.itemId)! - order.get(b.itemId)!)
      .filter((item) => item.total > 0)
      .map((item) => {
        const full = source!.full_items[item.itemId];
        const share = item.total / source!.total;
        const segment = {
          id: item.itemId,
          name: full?.name ?? "Unknown",
          image: full?.images?.at(-1)?.url,
          color: artistColor(item.itemId),
          count: item.total,
          share,
          bottom,
        };
        bottom += share;
        return segment;
      });
    // The API returns the top 20 per hour, with a denominator for ALL plays.
    // Keep the omitted share visible rather than renormalizing the top 20.
    const other =
      (source?.total ?? 0) -
      segments.reduce((sum, item) => sum + item.count, 0);
    if (other > 0)
      segments.push({
        id: "__other__",
        name: "Other",
        image: undefined,
        color: "var(--hourly-other)",
        count: other,
        share: other / source!.total,
        bottom,
      });
    return { hour, total: source?.total ?? 0, segments };
  });
}
