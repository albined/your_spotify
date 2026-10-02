import { Router } from "express";
import { z } from "zod";

import {
  getArtistVisibility,
  removeArtistVisibility,
  searchVisibilityArtists,
  setArtistVisibility,
} from "../database/queries/artistVisibility";
import { logged, validate } from "../tools/middleware";
import { LoggedRequest } from "../tools/types";

export const router = Router();
const path = z.object({ id: z.string().min(1).max(256) });

router.get("/", logged, async (req, res) => {
  res.json(await getArtistVisibility((req as LoggedRequest).user._id));
});

router.get("/search", logged, async (req, res) => {
  const { query } = validate(
    req.query,
    z.object({ query: z.string().trim().min(1).max(80) }),
  );
  res.json(await searchVisibilityArtists(query));
});

router.put("/:id", logged, async (req, res) => {
  const { user } = req as LoggedRequest;
  const { id } = validate(req.params, path);
  const { hidden } = validate(req.body, z.object({ hidden: z.boolean() }));
  await setArtistVisibility(user._id, id, hidden);
  res.sendStatus(204);
});

router.delete("/:id", logged, async (req, res) => {
  const { id } = validate(req.params, path);
  await removeArtistVisibility((req as LoggedRequest).user._id, id);
  res.sendStatus(204);
});
