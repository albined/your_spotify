import { Router } from "express";
import { z } from "zod";

import { ArtistModel } from "../database/Models";
import {
  artistGroups,
  deleteArtistGroup,
  saveArtistGroup,
} from "../database/queries/artistGroups";
import { admin, isLoggedOrGuest, logged, validate } from "../tools/middleware";

export const router = Router();
const groupSchema = z.object({
  name: z.string().trim().min(1).max(80),
  memberIds: z.array(z.string().min(1).max(256)).min(2).max(50),
  imageArtistId: z.string().min(1).max(256),
  enabled: z.boolean(),
});
const path = z.object({ id: z.string().startsWith("group:").max(256) });
const revision = z.object({ revision: z.number().int().positive() });

router.get("/", isLoggedOrGuest, async (_, res) => {
  const { groups, artists } = await artistGroups();
  const members = await ArtistModel.find({
    id: { $in: groups.flatMap((group) => group.memberIds) },
  })
    .select("id name images")
    .lean();
  res.json({ groups, artists, members });
});

router.get("/search", logged, admin, async (req, res) => {
  const { query } = validate(
    req.query,
    z.object({ query: z.string().trim().min(1).max(80) }),
  );
  const pattern = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  res.json(
    await ArtistModel.find({ name: { $regex: pattern, $options: "i" } })
      .select("id name images")
      .sort({ name: 1, id: 1 })
      .limit(30)
      .lean(),
  );
});

router.post("/", logged, admin, async (req, res) => {
  res.status(201).json(await saveArtistGroup(validate(req.body, groupSchema)));
});

router.put("/:id", logged, admin, async (req, res) => {
  const { id } = validate(req.params, path);
  const { revision: version, ...input } = validate(
    req.body,
    groupSchema.extend(revision.shape),
  );
  res.json(await saveArtistGroup(input, id, version));
});

router.delete("/:id", logged, admin, async (req, res) => {
  const { id } = validate(req.params, path);
  const { revision: version } = validate(req.body, revision);
  await deleteArtistGroup(id, version);
  res.sendStatus(204);
});
