import { unlink } from "fs/promises";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const xlsxName = "xlsx";
const XLSX = require(xlsxName);

import {
  addTrackIdsToUser,
  getCloseTrackId,
  storeFirstListenedAtIfLess,
} from "../../database";
import { setImporterStateCurrent } from "../../database/queries/importer";
import { RecentlyPlayedTrack } from "../../database/schemas/track";
import { User } from "../../database/schemas/user";
import {
  getTracksAlbumsArtists,
  storeTrackAlbumArtist,
} from "../../spotify/dbTools";
import { logger } from "../logger";
import {
  beforeParenthesis,
  minOfArray,
  removeDiacritics,
  retryPromise,
} from "../misc";
import { SpotifyAPI } from "../apis/spotifyApi";
import { Infos } from "../../database/schemas/info";
import { getFromCache, setToCache, SpotifyTrackCacheItem } from "./cache";
import { HistoryImporter, DeezerImporterState } from "./types";

export interface DeezerItem {
  title: string;
  artist: string;
  isrc: string;
  album: string;
  listeningTimeMs: number;
  playedAtStr: string;
}

export class DeezerImporter implements HistoryImporter<"deezer"> {
  private id: string;
  private userId: string;
  private elements: DeezerItem[] | null;
  private currentItem: number;
  private spotifyApi: SpotifyAPI;

  constructor(user: User) {
    this.id = "";
    this.userId = user._id.toString();
    this.elements = null;
    this.currentItem = 0;
    this.spotifyApi = new SpotifyAPI(this.userId);
  }

  searchISRC = async (isrc: string) => {
    const isrcQuery = `isrc:${isrc}`;
    const res = await retryPromise(
      () => this.spotifyApi.raw(`/search?q=${encodeURIComponent(isrcQuery)}&type=track&limit=1`),
      10,
      30,
    );
    if (res.data && res.data.tracks && res.data.tracks.items.length > 0) {
      return res.data.tracks.items[0];
    }
    return undefined;
  };

  searchText = async (track: string, artist: string) => {
    const res = await retryPromise(
      () => this.spotifyApi.search(track, artist),
      10,
      30,
    );
    return res;
  };

  storeItems = async (userId: string, items: RecentlyPlayedTrack[]) => {
    const { tracks, albums, artists } = await getTracksAlbumsArtists(
      userId,
      items.map(it => it.track),
    );
    await storeTrackAlbumArtist({ tracks, albums, artists });
    const finalInfos: Omit<Infos, "owner">[] = [];
    for (let i = 0; i < items.length; i += 1) {
      const item = items[i]!;
      const date = new Date(item.played_at);
      const duplicate = await getCloseTrackId(
        this.userId.toString(),
        item.track.id,
        date,
        60,
      );
      const currentImportDuplicate = finalInfos.find(
        e => Math.abs(e.played_at.getTime() - date.getTime()) <= 60 * 1000,
      );
      if (duplicate.length > 0 || currentImportDuplicate) {
        logger.info(
          `${item.track.name} - ${item.track.artists[0]?.name} was duplicate`,
        );
        continue;
      }
      const [primaryArtist] = item.track.artists;
      if (!primaryArtist) {
        continue;
      }
      finalInfos.push({
        played_at: date,
        id: item.track.id,
        primaryArtistId: primaryArtist.id,
        albumId: item.track.album.id,
        artistIds: item.track.artists.map(e => e.id),
        durationMs: item.track.duration_ms,
      });
    }
    await setImporterStateCurrent(this.id, this.currentItem + 1);
    await addTrackIdsToUser(this.userId.toString(), finalInfos);
    const min = minOfArray(finalInfos, info => info.played_at.getTime());
    if (min) {
      const minInfo = finalInfos[min.minIndex];
      if (minInfo) {
        await storeFirstListenedAtIfLess(this.userId, minInfo.played_at);
      }
    }
  };

  initWithFiles = async (filePaths: string[]) => {
    try {
      const allItems: DeezerItem[] = [];

      for (const filePath of filePaths) {
        const workbook = XLSX.readFile(filePath);
        const sheetName = '10_listeningHistory';
        const worksheet = workbook.Sheets[sheetName];

        if (!worksheet) {
          logger.warn(`Sheet ${sheetName} not found in Excel file: ${filePath}`);
          continue;
        }

        const objectData = XLSX.utils.sheet_to_json(worksheet) as any[];

        for (const row of objectData) {
          const listeningTimeSec = parseInt(row['Listening Time'], 10);
          const dateStr = row['Date'];

          if (!dateStr) {
            continue;
          }

          if (isNaN(listeningTimeSec) || listeningTimeSec < 30) {
            continue;
          }

          allItems.push({
            title: row['Song Title'] || '',
            artist: row['Artist'] || '',
            isrc: row['ISRC'] || '',
            album: row['Album Title'] || '',
            listeningTimeMs: listeningTimeSec * 1000,
            playedAtStr: dateStr,
          });
        }
      }

      this.elements = allItems;
      return true;
    } catch (e) {
      logger.error('Failed to parse Deezer Excel files:', e);
      return false;
    }
  };

  init = async (
    existingState: DeezerImporterState | null,
    filePaths: string[],
  ) => {
    try {
      this.currentItem = existingState?.current ?? 0;
      const success = await this.initWithFiles(filePaths);
      if (success && this.elements) {
        return { total: this.elements.length };
      }
    } catch (e) {
      logger.error(e);
    }
    return null;
  };

  trySearching = async (
    isrc: string,
    artistName: string,
    trackName: string,
  ): Promise<SpotifyTrackCacheItem> => {
    // 1. Try ISRC first
    if (isrc) {
      const foundByIsrc = await this.searchISRC(isrc);
      if (foundByIsrc) {
        return { exists: true, track: foundByIsrc };
      }
    }

    // 2. Try text search
    let found = await this.searchText(
      removeDiacritics(trackName),
      removeDiacritics(artistName),
    );
    if (!found) {
      found = await this.searchText(
        removeDiacritics(beforeParenthesis(trackName)),
        removeDiacritics(beforeParenthesis(artistName)),
      );
    }
    if (!found) {
      return { exists: false };
    }
    return { exists: true, track: found };
  };

  run = async (id: string) => {
    this.id = id;
    let items: RecentlyPlayedTrack[] = [];
    if (!this.elements) {
      return false;
    }
    for (let i = this.currentItem; i < this.elements.length; i += 1) {
      this.currentItem = i;
      const content = this.elements[i]!;

      let item = getFromCache(
        this.userId.toString(),
        content.title,
        content.artist,
      );
      if (!item) {
        item = await this.trySearching(content.isrc, content.artist, content.title);
        setToCache(
          this.userId.toString(),
          content.title,
          content.artist,
          item,
        );
        if (!item.exists) {
          logger.warn(
            `${content.title} by ${content.artist} was not found by search`,
          );
          continue;
        }
      }
      if (!item.exists) {
        continue;
      }
      logger.info(
        `Adding ${item.track.name} - ${item.track.artists[0]?.name} from data (${i}/${this.elements.length})`,
      );
      items.push({ track: item.track, played_at: content.playedAtStr });
      if (items.length >= 20) {
        await this.storeItems(this.userId, items);
        items = [];
      }
    }
    if (items.length > 0) {
      await this.storeItems(this.userId, items);
      items = [];
    }
    return true;
  };

  cleanup = async (filePaths: string[]) => {
    await Promise.all(filePaths.map(f => unlink(f)));
  };
}
