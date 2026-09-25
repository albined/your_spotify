interface RaceEntry {
  _id: string;
  duration: number;
  crownMs: number;
}

const byTotal = (a: RaceEntry, b: RaceEntry) =>
  b.duration - a.duration || a._id.localeCompare(b._id);

/** Feed positive-duration plays in timestamp order, then select once at end. */
export class RaceLeaders {
  private entries = new Map<string, RaceEntry>();
  private leaders = new Map<string, number>();
  private maximum = 0;
  private firstPlay: number | undefined;

  private creditLeaders(until: number) {
    for (const [id, since] of this.leaders) {
      this.entries.get(id)!.crownMs += until - since;
    }
    this.leaders.clear();
  }

  add(id: string, timestamp: number, duration: number) {
    this.firstPlay ??= timestamp;
    const entry = this.entries.get(id) ?? { _id: id, duration: 0, crownMs: 0 };
    entry.duration += duration;
    this.entries.set(id, entry);
    // Positive durations mean only the entry just played can take the lead.
    // Simultaneous plays contribute no elapsed time between their updates.
    if (entry.duration > this.maximum) {
      this.creditLeaders(timestamp);
      this.maximum = entry.duration;
      this.leaders.set(id, timestamp);
    } else if (entry.duration === this.maximum) {
      this.leaders.set(id, timestamp);
    }
  }

  select(end: number) {
    this.creditLeaders(end);
    const ranked = [...this.entries.values()].sort(byTotal);
    const selected = new Map(ranked.slice(0, 5).map((row) => [row._id, row]));
    // A former leader must have meaningful listening AND a sustained reign.
    // Relative thresholds scale from short ranges to years of history.
    const minimumListening = (ranked[4]?.duration ?? 0) * 0.25;
    const minimumReign = Math.max(0, end - (this.firstPlay ?? end)) * 0.05;
    const leaders = ranked
      .filter(
        (row) =>
          row.crownMs > 0 &&
          row.crownMs >= minimumReign &&
          row.duration >= minimumListening,
      )
      .sort((a, b) => b.crownMs - a.crownMs || byTotal(a, b));
    for (const row of [...leaders, ...ranked]) {
      if (selected.size >= 10) break;
      selected.set(row._id, row);
    }
    return [...selected.values()].sort(byTotal);
  }
}
