import { HOUR_MS } from "./listeningTimelineTools";

export interface ArtistPeriod {
  artist: string;
  period: number;
  duration: number;
}

interface RankedArtist {
  id: string;
  total: number;
  appearances: number;
  eraDuration: number;
}

export function selectEraArtists(periods: ArtistPeriod[]) {
  const artists = new Map<string, RankedArtist>();
  const grouped = new Map<number, ArtistPeriod[]>();
  for (const row of periods) {
    const artist = artists.get(row.artist) ?? {
      id: row.artist,
      total: 0,
      appearances: 0,
      eraDuration: 0,
    };
    artist.total += row.duration;
    artists.set(row.artist, artist);
    const group = grouped.get(row.period) ?? [];
    group.push(row);
    grouped.set(row.period, group);
  }
  const totals = [...grouped.values()]
    .map((rows) => rows.reduce((sum, row) => sum + row.duration, 0))
    .sort((a, b) => a - b);
  const middle = Math.floor(totals.length / 2);
  const median = totals.length
    ? (totals[middle]! + totals[Math.floor((totals.length - 1) / 2)]!) / 2
    : 0;
  // Ignore near-empty periods while adapting to each listener's activity.
  const minimum = Math.max(HOUR_MS / 2, median * 0.1);
  for (const rows of grouped.values()) {
    if (rows.reduce((sum, row) => sum + row.duration, 0) < minimum) continue;
    rows.sort(
      (a, b) => b.duration - a.duration || a.artist.localeCompare(b.artist),
    );
    for (const row of rows.slice(0, 3)) {
      const artist = artists.get(row.artist)!;
      artist.appearances += 1;
      artist.eraDuration += row.duration;
    }
  }
  const byTotal = (a: RankedArtist, b: RankedArtist) =>
    b.total - a.total || a.id.localeCompare(b.id);
  const overall = [...artists.values()].sort(byTotal);
  const eras = overall
    .filter((artist) => artist.appearances >= 2)
    .sort(
      (a, b) =>
        b.appearances - a.appearances ||
        b.eraDuration - a.eraDuration ||
        byTotal(a, b),
    );
  const select = (limit: number) => {
    const ids = new Set(overall.slice(0, limit / 2).map((artist) => artist.id));
    for (const artist of [...eras, ...overall]) {
      if (ids.size >= limit) break;
      ids.add(artist.id);
    }
    return [...ids];
  };
  return { 10: select(10), 20: select(20) };
}
