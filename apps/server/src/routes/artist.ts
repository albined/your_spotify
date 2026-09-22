import { Router } from "express";
import { z } from "zod";

import {
  getArtists,
  getFirstAndLastListened,
  getMostListenedSongOfArtist,
  bestPeriodOfArtist,
  getTotalListeningOfArtist,
  searchArtist,
  blacklistArtist,
  unblacklistArtist,
  blacklistByArtist,
  unblacklistByArtist,
  getMostListenedAlbumOfArtist,
  getRankOf,
  ItemType,
} from "../database";
import {
  artistMemberIds,
  resolveArtistId,
} from "../database/queries/artistGroups";
import { getArtistTimeline } from "../database/queries/listeningTimeline";
import { isLoggedOrGuest, logged, validate } from "../tools/middleware";
import { LoggedRequest } from "../tools/types";

export const router = Router();

router.param("id", async (req, _res, next, id) => {
  req.params.id = await resolveArtistId(id);
  next();
});

const getArtistsSchema = z.object({ ids: z.string() });

router.get("/:ids", isLoggedOrGuest, async (req, res) => {
  const { ids } = validate(req.params, getArtistsSchema);
  const artists = await getArtists(ids.split(","));
  if (!artists || artists.length === 0) {
    res.status(404).end();
    return;
  }
  res.status(200).send(artists);
});

const getArtistStats = z.object({ id: z.string() });

router.get("/:id/listening-timeline", isLoggedOrGuest, async (req, res) => {
  const { user } = req as LoggedRequest;
  const { id } = validate(req.params, getArtistStats);
  res.status(200).send(await getArtistTimeline(user, id));
});

router.get("/:id/stats", isLoggedOrGuest, async (req, res) => {
  const { user } = req as LoggedRequest;
  const { id } = validate(req.params, getArtistStats);

  const [artist] = await getArtists([id]);
  if (!artist) {
    res.status(404).end();
    return;
  }
  const promises = [
    getFirstAndLastListened(user, id),
    getMostListenedSongOfArtist(user, id, 10),
    getMostListenedAlbumOfArtist(user, id),
    bestPeriodOfArtist(user, id),
    getTotalListeningOfArtist(user, id),
  ];
  const [firstLast, mostListened, albumMostListened, bestPeriod, total] =
    await Promise.all(promises);
  if (!total) {
    res.status(200).send({ code: "NEVER_LISTENED" });
    return;
  }
  res
    .status(200)
    .send({
      artist,
      firstLast,
      mostListened,
      albumMostListened,
      bestPeriod,
      total,
    });
});

router.get("/:id/rank", isLoggedOrGuest, async (req, res) => {
  const { user } = req as LoggedRequest;
  const { id } = validate(req.params, getArtistStats);

  const [artist] = await getArtists([id]);
  if (!artist) {
    res.status(404).end();
    return;
  }
  const rank = await getRankOf(ItemType.artist, user, id);
  res.status(200).send(rank);
});

const search = z.object({ query: z.string().min(3).max(64) });

router.get("/search/:query", isLoggedOrGuest, async (req, res) => {
  const { query } = validate(req.params, search);

  const results = await searchArtist(query);
  res.status(200).send(results);
});

const blacklist = z.object({ id: z.string() });

router.post("/blacklist/:id", logged, async (req, res) => {
  const { user } = req as LoggedRequest;
  const { id } = validate(req.params, blacklist);

  for (const member of await artistMemberIds(id)) {
    await blacklistArtist(user._id.toString(), member);
    await blacklistByArtist(user._id.toString(), member);
  }
  res.status(204).end();
});

router.post("/unblacklist/:id", logged, async (req, res) => {
  const { user } = req as LoggedRequest;
  const { id } = validate(req.params, blacklist);

  for (const member of await artistMemberIds(id)) {
    await unblacklistArtist(user._id.toString(), member);
    await unblacklistByArtist(user._id.toString(), member);
  }
  res.status(204).end();
});
