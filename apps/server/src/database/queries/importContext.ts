import { Types } from "mongoose";

import { ImportRecord, privacySourceKey } from "../../tools/importers/records";
import { InfosModel, TrackModel, UserModel } from "../Models";
import { Infos } from "../schemas/info";
import { Track } from "../schemas/track";
import { User } from "../schemas/user";

type Identity = Pick<Track, "id" | "name" | "artists" | "external_ids">;
const normalized = (value: string) =>
  value.normalize("NFKC").trim().toLowerCase();
// Strip version labels, while keeping meaningful parts of a song title.
const baseTitle = (value: string) =>
  normalized(value)
    .replace(/[‘’]/g, "'")
    .replace(/\s*[([](?:feat\.|featuring|with)\s[^)\]]*[)\]]/g, "")
    .replace(/\s*[-–—]\s*from .*(?:album|soundtrack)$/, "")
    .replace(
      /\s*(?:[-–—]\s*|[([])(?=[^()[\]]*\b(?:remix|mix|edit|remaster(?:ed)?|acoustic|extended|original|live|version|performance|avicii by avicii)\b)[^()[\]]*[)\]]?$/,
      "",
    )
    .trim();

/** Per-import caches for recording identities and durable account membership. */
export class ImportContext {
  reviewMapping?: { id: string; trackId: string };
  holdUnmatched = false;
  private spotifyEvents = new Map<string, ImportRecord[]>();
  private unresolvedSpotifyEvents?: ImportRecord[];
  private privacyEvents = new Map<string, Set<string>>();
  private spotifyStart = Infinity;
  private spotifyEnd = -Infinity;
  constructor(
    readonly repairLegacyDeezer = false,
    rows: ImportRecord[] = [],
  ) {
    for (const row of rows) {
      if (row.source !== "full-privacy" || !row.spotifyId || row.invalid)
        continue;
      this.spotifyStart = Math.min(this.spotifyStart, row.at.getTime());
      this.spotifyEnd = Math.max(this.spotifyEnd, row.at.getTime());
      const events = this.spotifyEvents.get(row.spotifyId) ?? [];
      events.push(row);
      this.spotifyEvents.set(row.spotifyId, events);
      if (!row.ambiguous && (row.listenedMs ?? 0) >= 30000) {
        const key = `${privacySourceKey(row)}:${row.listenedMs}`;
        const precise = this.privacyEvents.get(key) ?? new Set();
        precise.add(row.key);
        this.privacyEvents.set(key, precise);
      }
    }
  }

  privacyUpgradeKey(row: ImportRecord) {
    if (row.source !== "full-privacy") return undefined;
    const key = privacySourceKey(row);
    return this.privacyEvents.get(`${key}:${row.listenedMs}`)?.size === 1
      ? key
      : undefined;
  }

  hasUnresolvedSpotifyCompetitor(
    row: ImportRecord,
    plays: Infos[],
    ids: string[],
  ) {
    if (row.source !== "full-privacy" || !plays.length) return false;
    const unresolved = (this.unresolvedSpotifyEvents ??= [
      ...this.spotifyEvents,
    ].flatMap(([id, events]) =>
      this.ids.get(id)?.external_ids?.isrc ? [] : events,
    ));
    if (!unresolved.length) return false;
    const known = [...new Set([...ids, row.spotifyId!])]
      .flatMap((id) => this.spotifyEvents.get(id) ?? [])
      .filter((event) => (event.listenedMs ?? 0) >= 30000);
    const distances = plays.map((play) => ({
      at: play.played_at.getTime(),
      nearest: known.reduce(
        (best, event) =>
          Math.min(
            best,
            Math.abs(event.at.getTime() - play.played_at.getTime()),
          ),
        Infinity,
      ),
    }));
    return unresolved.some(
      (event) =>
        event.spotifyId !== row.spotifyId &&
        distances.some(
          ({ at, nearest }) => Math.abs(event.at.getTime() - at) <= nearest,
        ),
    );
  }

  /** Prefer the precise export's qualifying plays over uncertain API timing. */
  closestSpotifyListen<T extends Infos & { _id: Types.ObjectId }>(
    row: ImportRecord,
    plays: T[],
    ids: string[],
  ): { existing: T | null } | undefined {
    if (row.source !== "full-privacy") return undefined;
    const recordingIds = new Set(ids);
    if (row.spotifyId) recordingIds.add(row.spotifyId);
    const events = [...recordingIds]
      .flatMap((id) => this.spotifyEvents.get(id) ?? [])
      .filter((event) => (event.listenedMs ?? 0) >= 30000)
      .sort(
        (a, b) => a.at.getTime() - b.at.getTime() || a.key.localeCompare(b.key),
      );
    if (!events.some((event) => event.key === row.key)) return undefined;
    const owned: T[] = [];
    for (const play of plays) {
      const at = play.played_at.getTime();
      // A partial upload cannot explain events outside its date range.
      if (at < this.spotifyStart || at > this.spotifyEnd) return undefined;
      const nearest = events.reduce((best, event) =>
        Math.abs(event.at.getTime() - at) < Math.abs(best.at.getTime() - at)
          ? event
          : best,
      );
      if (nearest.ambiguous) return undefined;
      if (nearest.key === row.key) owned.push(play);
    }
    // Each API record belongs to only one export event, including events already
    // imported or explicitly excluded. Extra nearby records cannot migrate to
    // another event as the import advances. Stable ties also survive reordering.
    owned.sort(
      (a, b) =>
        Math.abs(a.played_at.getTime() - row.at.getTime()) -
          Math.abs(b.played_at.getTime() - row.at.getTime()) ||
        a.played_at.getTime() - b.played_at.getTime() ||
        a._id.toString().localeCompare(b._id.toString()),
    );
    return { existing: owned[0] ?? null };
  }

  /** Use the whole export, including skips, before associating delayed API events. */
  spotifyEndMatch(row: ImportRecord, play: Infos, ids: string[]) {
    if (row.source !== "full-privacy" || play.listeningSource) return null;
    const events = [
      ...new Set([...ids, row.spotifyId].filter(Boolean)),
    ].flatMap((id) => this.spotifyEvents.get(id!) ?? []);
    if (!events.length) return null;
    const at = play.played_at.getTime();
    const distances = events.map((event) => Math.abs(event.at.getTime() - at));
    const closest = distances.reduce(
      (best, value) => Math.min(best, value),
      Infinity,
    );
    const nearest = events.filter((_, index) => distances[index] === closest);
    const same = nearest.every((event) => event.key === row.key);
    if (closest <= 60000 && same && at >= row.at.getTime() - row.precisionMs)
      return "same";
    // A precise match to another event is evidence that this is a separate play.
    // A nearby skip still needs a clear separation from competing events.
    if (
      closest <= 60000 &&
      nearest.every(
        (event) =>
          event.key !== row.key &&
          (closest < 1000 ||
            ((event.listenedMs ?? 0) >= 30000 && at >= event.at.getTime())),
      )
    )
      return "other";

    // Delayed API timestamps may be minutes away. Only use the wider window
    // for a clearly isolated source event within the uploaded time range.
    // Include short skips as competitors; never infer a recording from names.
    const winner = nearest[0]!;
    const limit = Math.max(
      900000,
      (winner.listenedMs ?? 0) + 60000,
      play.durationMs + 60000,
    );
    const runnerUp = events.reduce(
      (best, event, index) =>
        event.key === winner.key ? best : Math.min(best, distances[index]!),
      Infinity,
    );
    if (
      closest <= limit &&
      at >= this.spotifyStart &&
      at <= this.spotifyEnd &&
      at >=
        winner.at.getTime() -
          Math.max(winner.listenedMs ?? 0, play.durationMs) -
          60000 &&
      nearest.every(
        (event) =>
          event.key === winner.key &&
          !event.ambiguous &&
          event.listenedMs !== null,
      ) &&
      runnerUp - closest >= 60000
    )
      return same ? "same" : "other";
    return closest <= 60000 ? "uncertain" : null;
  }

  private membership?: Set<string>;
  private firstListenedAt = Infinity;
  private loaded = false;
  private ids = new Map<string, Identity>();
  private recordings = new Map<string, Identity[]>();
  private titles = new Map<string, Identity[]>();
  private tracks = new Map<string, Track>();
  private sourceTracks = new Map<string, Track>();

  async prefetchSourceTracks(user: User, rows: ImportRecord[]) {
    this.sourceTracks.clear();
    if (!rows.length) return;
    const plays = await InfosModel.find({
      owner: user._id,
      sourceKeys: {
        $in: rows.flatMap((row) => row.deezerPolicy?.sourceKeys ?? [row.key]),
        $type: "string",
      },
    })
      .select("id sourceKeys")
      .lean();
    const missing = [...new Set(plays.map((play) => play.id))].filter(
      (id) => !this.tracks.has(id),
    );
    if (missing.length) {
      for (const track of await TrackModel.find({
        id: { $in: missing },
      }).lean())
        this.tracks.set(track.id, track);
    }
    for (const play of plays) {
      const track = this.tracks.get(play.id);
      if (track)
        for (const key of play.sourceKeys ?? [])
          this.sourceTracks.set(key, track);
    }
  }

  knownTrack(row: ImportRecord) {
    return (row.deezerPolicy?.sourceKeys ?? [row.key])
      .map((key) => this.sourceTracks.get(key))
      .find(Boolean);
  }

  canRepairRecording(row: ImportRecord, track: Track, play: Infos) {
    if (
      this.reviewMapping?.trackId === track.id &&
      row.source === "deezer" &&
      !play.provider &&
      !play.listeningSource &&
      !play.sourceKeys?.length &&
      !row.deezerPolicy?.timestampUncertain
    )
      return true;
    const previous = this.ids.get(play.id);
    const oldIsrc = previous?.external_ids?.isrc?.toUpperCase();
    const newIsrc = track.external_ids?.isrc?.toUpperCase();
    if (
      row.deezerPolicy?.timestampUncertain &&
      oldIsrc &&
      row.deezerPolicy.timestampIsrcs.includes(oldIsrc)
    )
      return false;
    return Boolean(
      this.repairLegacyDeezer &&
      row.source === "deezer" &&
      !play.provider &&
      !play.listeningSource &&
      !play.sourceKeys?.length &&
      oldIsrc &&
      newIsrc &&
      oldIsrc !== newIsrc &&
      newIsrc === row.isrc?.toUpperCase() &&
      track.artists[0] &&
      previous?.artists[0] === track.artists[0] &&
      play.primaryArtistId === track.artists[0] &&
      baseTitle(previous.name) === baseTitle(row.title) &&
      baseTitle(track.name) === baseTitle(row.title),
    );
  }

  async repairMembership(user: User, play: Infos & { _id: Types.ObjectId }) {
    if (!this.membership) {
      const current = await UserModel.findById(user._id)
        .select("+tracks firstListenedAt")
        .lean();
      if (!current) throw new Error("Import account no longer exists");
      this.membership = new Set(
        (current.tracks ?? []).map((id) => id.toString()),
      );
      this.firstListenedAt = current.firstListenedAt?.getTime() ?? Infinity;
    }
    const id = play._id.toString();
    if (!this.membership.has(id)) {
      await UserModel.updateOne(
        { _id: user._id },
        { $addToSet: { tracks: play._id } },
      );
      this.membership.add(id);
    }
    if (play.played_at.getTime() < this.firstListenedAt) {
      await UserModel.updateOne(
        {
          _id: user._id,
          $or: [
            { firstListenedAt: { $gt: play.played_at } },
            { firstListenedAt: null },
          ],
        },
        { $set: { firstListenedAt: play.played_at } },
      );
      this.firstListenedAt = play.played_at.getTime();
    }
  }

  remember(track: Identity) {
    const previous = this.ids.get(track.id);
    if (previous) {
      // Metadata may be filled in after the catalog was first cached.
      const isrc = track.external_ids?.isrc?.toUpperCase();
      if (isrc && !previous.external_ids?.isrc) {
        this.unresolvedSpotifyEvents = undefined;
        previous.external_ids = { isrc };
        this.recordings.set(isrc, [
          ...(this.recordings.get(isrc) ?? []),
          previous,
        ]);
      }
      return;
    }
    this.unresolvedSpotifyEvents = undefined;
    this.ids.set(track.id, track);
    const title = normalized(track.name);
    this.titles.set(title, [...(this.titles.get(title) ?? []), track]);
    const isrc = track.external_ids?.isrc?.toUpperCase();
    if (isrc)
      this.recordings.set(isrc, [...(this.recordings.get(isrc) ?? []), track]);
  }

  async matchingTracks(row: ImportRecord, track: Track) {
    if (!this.loaded) {
      // Read compact catalog identities once per import, not once per row.
      const catalog = await TrackModel.find()
        .select("id name artists external_ids")
        .lean();
      for (const item of catalog) this.remember(item);
      this.loaded = true;
    }
    // Include metadata resolved since the initial catalog read.
    this.remember(track);
    const isrc = (
      this.reviewMapping
        ? track.external_ids?.isrc
        : row.isrc || track.external_ids?.isrc
    )?.toUpperCase();
    const confirmed = new Set([track.id]);
    if (isrc)
      for (const candidate of this.recordings.get(isrc) ?? [])
        confirmed.add(candidate.id);
    const uncertain = new Set<string>();
    for (const title of [row.title, track.name]) {
      for (const candidate of this.titles.get(normalized(title)) ?? []) {
        if (
          !confirmed.has(candidate.id) &&
          candidate.artists.some((id) => track.artists.includes(id))
        )
          uncertain.add(candidate.id);
      }
    }
    return { confirmed: [...confirmed], uncertain: [...uncertain] };
  }
}
