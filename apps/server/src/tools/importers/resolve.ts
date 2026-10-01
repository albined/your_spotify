import { ArtistModel, InfosModel, TrackModel } from "../../database/Models";
import { SpotifyTrack, Track } from "../../database/schemas/track";
import {
  getTracksAlbumsArtists,
  storeRecordingIds,
  storeTrackAlbumArtist,
} from "../../spotify/dbTools";
import { SpotifyAPI } from "../apis/spotifyApi";
import { longWriteDbLock } from "../lock";
import { retryPromise } from "../misc";
import { ImportRecord } from "./records";

const normalized = (value: string) =>
  value.normalize("NFKC").trim().toLowerCase();

export class ImportResolver {
  private cache = new Map<string, Track | null>();
  private recordings = new Map<string, Track>();
  private refreshed = new Set<string>();
  private api: SpotifyAPI;
  constructor(private userId: string) {
    this.api = new SpotifyAPI(userId);
  }

  async prefetchLegacyRecordings(rows: ImportRecord[]) {
    const dates = rows
      .filter((row) => row.source === "deezer")
      .map((row) => row.at);
    if (!dates.length) return [];
    // Old imports lost provider and recording IDs. Refresh only catalog items
    // actually present at these export timestamps, once per distinct track.
    const ids: string[] = await InfosModel.distinct("id", {
      owner: this.userId,
      provider: { $exists: false },
      listeningSource: { $exists: false },
      played_at: { $in: dates },
    });
    const missing = await TrackModel.find({
      id: { $in: ids.filter((id) => !this.refreshed.has(id)) },
      "external_ids.isrc": { $in: [null, ""] },
    })
      .select("id")
      .lean();
    if (!missing.length) return [];
    const refreshIds = missing.map((track) => track.id);
    const results = await retryPromise(
      () => this.api.getTracks(refreshIds),
      3,
      30,
    );
    // A relinked response must not assign another release's identifier to the
    // requested catalog ID. Unavailable metadata remains uncertain.
    const tracks = results.filter((track): track is SpotifyTrack =>
      Boolean(track && refreshIds.includes(track.id)),
    );
    await longWriteDbLock.lock();
    try {
      await storeRecordingIds(tracks);
    } finally {
      longWriteDbLock.unlock();
    }
    for (const id of refreshIds) this.refreshed.add(id);
    const stored = await TrackModel.find({ id: { $in: refreshIds } }).lean();
    for (const track of stored) this.rememberRecording(track);
    return stored;
  }

  private rememberRecording(track: Track) {
    const isrc = track.external_ids?.isrc?.toUpperCase();
    if (isrc) this.recordings.set(isrc, track);
  }

  async prefetchSpotifyTimeline(rows: ImportRecord[]) {
    const ids = [
      ...new Set(
        rows
          .filter((row) => row.source === "full-privacy" && !row.invalid)
          .map((row) => row.spotifyId)
          .filter((id): id is string => Boolean(id)),
      ),
    ];
    // All competing releases must be known before any event claims an API play.
    // Include skips and excluded rows: they still explain nearby API timestamps.
    await this.prefetchIds(ids, true);
    return ids.flatMap((id) => {
      const track = this.cache.get(id);
      // A relinked response identifies both the uploaded ID and its replacement.
      return track ? [track, { ...track, id }] : [];
    });
  }

  async prefetch(rows: ImportRecord[]) {
    const ids = [
      ...new Set(
        rows
          .filter(
            (row) =>
              !row.invalid && !row.ambiguous && (row.listenedMs ?? 0) >= 30000,
          )
          .map((row) => row.spotifyId)
          .filter((id): id is string => Boolean(id)),
      ),
    ];
    await this.prefetchIds(ids);
  }

  private async prefetchIds(ids: string[], refreshRecordingIds = false) {
    ids = ids.filter((id) => !this.cache.has(id));
    if (!ids.length) return;
    const stored = await TrackModel.find({ id: { $in: ids } }).lean();
    for (const track of stored) this.cache.set(track.id, track);
    const missing = ids.filter(
      (id) =>
        !this.cache.has(id) ||
        (refreshRecordingIds && !this.cache.get(id)?.external_ids?.isrc),
    );
    for (let offset = 0; offset < missing.length; offset += 45) {
      const batch = missing.slice(offset, offset + 45);
      const found = await retryPromise(() => this.api.getTracks(batch), 3, 30);
      const tracks = found.filter((track): track is SpotifyTrack =>
        Boolean(track),
      );
      if (tracks.length) {
        const metadata = await getTracksAlbumsArtists(this.userId, tracks);
        await longWriteDbLock.lock();
        try {
          await storeTrackAlbumArtist(metadata);
        } finally {
          longWriteDbLock.unlock();
        }
      }
      for (const [index, id] of batch.entries()) {
        const track = found[index];
        this.cache.set(
          id,
          track
            ? {
                ...track,
                album: track.album.id,
                artists: track.artists.map((artist) => artist.id),
              }
            : (this.cache.get(id) ?? null),
        );
      }
    }
  }

  async resolve(row: ImportRecord): Promise<Track | null> {
    const isrc = row.isrc?.toUpperCase();
    if (!row.spotifyId && isrc && this.recordings.has(isrc))
      return this.recordings.get(isrc)!;
    const key =
      row.spotifyId ?? JSON.stringify([row.isrc, row.title, row.artist]);
    if (this.cache.has(key)) return this.cache.get(key)!;
    let stored: Track | null = null;
    if (row.spotifyId)
      stored = await TrackModel.findOne({ id: row.spotifyId }).lean();
    else if (row.isrc)
      stored = await TrackModel.findOne({
        "external_ids.isrc": row.isrc.toUpperCase(),
      }).lean();
    else {
      const artists = await ArtistModel.find({ name: row.artist })
        .select("id")
        .lean();
      const tracks = await TrackModel.find({
        name: row.title,
        artists: { $in: artists.map((a) => a.id) },
      })
        .limit(2)
        .lean();
      if (tracks.length === 1) stored = tracks[0]!;
    }
    if (stored) {
      this.cache.set(key, stored);
      this.rememberRecording(stored);
      return stored;
    }
    let found: SpotifyTrack | undefined;
    if (row.spotifyId) {
      found = (
        await retryPromise(() => this.api.getTracks([row.spotifyId!]), 3, 30)
      )[0];
    } else {
      if (row.isrc) {
        const response = await retryPromise(
          () =>
            this.api.raw(
              `/search?q=${encodeURIComponent(`isrc:${row.isrc}`)}&type=track&limit=10`,
            ),
          3,
          30,
        );
        const candidates: SpotifyTrack[] = response.data?.tracks?.items ?? [];
        found = candidates.find(
          (candidate) => candidate.external_ids?.isrc?.toUpperCase() === isrc,
        );
      }
      if (!found) {
        const response = await retryPromise(
          () =>
            this.api.raw(
              `/search?q=track:${encodeURIComponent(row.title.slice(0, 100))}+artist:${encodeURIComponent(row.artist.slice(0, 100))}&type=track&limit=10`,
            ),
          3,
          30,
        );
        // Text search is approximate. Do not silently attach an unrelated result.
        const candidates: SpotifyTrack[] = response.data?.tracks?.items ?? [];
        found = candidates.find((candidate) =>
          isrc
            ? candidate.external_ids?.isrc?.toUpperCase() === isrc
            : normalized(candidate.name) === normalized(row.title) &&
              candidate.artists.some(
                (a) => normalized(a.name) === normalized(row.artist),
              ),
        );
      }
    }
    if (!found) {
      this.cache.set(key, null);
      return null;
    }
    // Metadata is fetched before the write lock; upserts tolerate concurrent ingestion.
    const metadata = await getTracksAlbumsArtists(this.userId, [found]);
    await longWriteDbLock.lock();
    try {
      await storeTrackAlbumArtist(metadata);
    } finally {
      longWriteDbLock.unlock();
    }
    const track: Track = {
      ...found,
      album: found.album.id,
      artists: found.artists.map((a) => a.id),
    };
    this.cache.set(key, track);
    this.rememberRecording(track);
    return track;
  }
}
