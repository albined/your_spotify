import type { Artist, Track, TrackInfo } from "./types";

export interface ListeningSession {
  sessionLength: number;
  full_tracks: Record<string, Track>;
  artists: Pick<Artist, "id" | "name" | "images">[];
  distanceToLast: { distance: { subtract: number; info: TrackInfo }[] };
}

export interface SessionSection {
  artist: string;
  start: number;
  end: number;
  songs: number;
}

// Preserve actual time: pauses remain gaps and a new play replaces any
// overlapping tail. Adjacent plays by the same artist share one section.
export function sessionSections(tracks: TrackInfo[]) {
  const ordered = tracks
    .filter(
      (track) =>
        Number.isFinite(track.durationMs) &&
        track.durationMs > 0 &&
        Number.isFinite(Date.parse(track.played_at)),
    )
    .sort(
      (a, b) =>
        Date.parse(a.played_at) - Date.parse(b.played_at) ||
        a._id.localeCompare(b._id),
    );
  const start = ordered.length ? Date.parse(ordered[0]!.played_at) : 0;
  const last = ordered.at(-1);
  const end = last ? Date.parse(last.played_at) + last.durationMs : start;
  const sections: SessionSection[] = [];
  ordered.forEach((track, index) => {
    const from = Date.parse(track.played_at);
    const to = Math.min(
      from + track.durationMs,
      ordered[index + 1] ? Date.parse(ordered[index + 1]!.played_at) : end,
    );
    if (to <= from) return;
    const previous = sections.at(-1);
    if (previous?.artist === track.primaryArtistId && previous.end === from) {
      previous.end = to;
      previous.songs++;
    } else {
      sections.push({
        artist: track.primaryArtistId || "unknown",
        start: from,
        end: to,
        songs: 1,
      });
    }
  });
  return { start, end, duration: end - start, sections };
}

export function artistColor(id: string) {
  let hash = 2166136261;
  for (const char of id) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return `hsl(${(hash >>> 0) % 360} 52% 53%)`;
}

export function sessionArtistBlocks(
  timeline: ReturnType<typeof sessionSections>,
) {
  const grouped = new Map<string, { duration: number; songs: number }>();
  for (const section of timeline.sections) {
    const artist = grouped.get(section.artist) ?? { duration: 0, songs: 0 };
    artist.duration += section.end - section.start;
    artist.songs += section.songs;
    grouped.set(section.artist, artist);
  }
  let position = 0;
  return [...grouped]
    .sort(
      ([a, left], [b, right]) =>
        right.duration - left.duration || a.localeCompare(b),
    )
    .map(([artist, { duration, songs }]) => {
      const start = position;
      position += duration;
      return { artist, start, end: position, songs };
    });
}

export function sessionArtwork(
  sections: SessionSection[],
  duration: number,
  width: number,
) {
  return new Set(
    sections
      .map((section, index) => ({
        index,
        width: ((section.end - section.start) / duration) * width,
      }))
      .filter((section) => section.width >= 34)
      .sort((a, b) => b.width - a.width || a.index - b.index)
      .slice(0, 10)
      .map((section) => section.index),
  );
}
