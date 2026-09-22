export interface SongPeriod {
  id: string;
  period: number;
  duration: number;
  plays: number;
}

export function selectEraAlbums(
  albums: { id: string; duration: number }[],
  artistDuration: number,
) {
  return albums
    .filter((album) => album.duration >= artistDuration * 0.02)
    .sort((a, b) => b.duration - a.duration || a.id.localeCompare(b.id))
    .slice(0, 10)
    .map((album) => album.id);
}

export function selectEraSongs(periods: SongPeriod[]) {
  const totals = new Map<string, number>();
  const grouped = new Map<number, SongPeriod[]>();
  for (const row of periods) {
    totals.set(row.id, (totals.get(row.id) ?? 0) + row.duration);
    const group = grouped.get(row.period) ?? [];
    group.push(row);
    grouped.set(row.period, group);
  }
  const overall = [...totals.keys()].sort(
    (a, b) => totals.get(b)! - totals.get(a)! || a.localeCompare(b),
  );
  const selected = new Set(overall.slice(0, 5));
  const activity = [...grouped.values()]
    .map((rows) => rows.reduce((sum, row) => sum + row.duration, 0))
    .sort((a, b) => a - b);
  const median = activity.length
    ? (activity[Math.floor(activity.length / 2)]! +
        activity[Math.floor((activity.length - 1) / 2)]!) /
      2
    : 0;
  // Cap the activity threshold so one huge burst cannot disqualify an older
  // half-hour phase, even when there are only two active periods in the history.
  const minimum = Math.max(10 * 60_000, Math.min(30 * 60_000, median * 0.1));
  // Every substantial local period has equal influence, regardless of hours.
  // A song's score measures how close it came to leading that period. Require
  // repeat listens so an incidental play cannot claim a reserved era row.
  const scores = [...grouped.entries()]
    .sort(([a], [b]) => a - b)
    .filter(
      ([, rows]) => rows.reduce((sum, row) => sum + row.duration, 0) >= minimum,
    )
    .map(([, rows]) => {
      const ranking = [...rows].sort(
        (a, b) => b.duration - a.duration || a.id.localeCompare(b.id),
      );
      return new Map(
        ranking
          .slice(0, 3)
          .filter((row) => row.plays >= 3)
          .map((row) => [row.id, row.duration / ranking[0]!.duration]),
      );
    });
  const coverage = scores.map((period) =>
    Math.max(0, ...[...selected].map((id) => period.get(id) ?? 0)),
  );
  while (selected.size < 10) {
    let best: string | undefined;
    let bestGain = 0;
    for (const id of overall) {
      if (selected.has(id)) continue;
      const gain = scores.reduce(
        (sum, period, index) =>
          sum + Math.max(0, (period.get(id) ?? 0) - coverage[index]!),
        0,
      );
      // Iterating in overall order gives stable, listening-time-based ties.
      if (gain > bestGain) {
        best = id;
        bestGain = gain;
      }
    }
    if (!best) break;
    selected.add(best);
    scores.forEach((period, index) => {
      coverage[index] = Math.max(coverage[index]!, period.get(best!) ?? 0);
    });
  }
  for (const id of overall) {
    if (selected.size >= 10) break;
    selected.add(id);
  }
  return [...selected];
}
