import { mkdirSync } from "node:fs";
import { unlink } from "node:fs/promises";

import { Router } from "express";
import multer from "multer";
import { z } from "zod";

import { ImporterStateModel } from "../database/Models";
import { getUserImporterState } from "../database/queries/importer";
import { listeningAccuracy } from "../database/queries/listeningAccuracy";
import { backupStatus } from "../tools/backups";
import { getWithDefault } from "../tools/env";
import {
  canUserImport,
  cleanupImport,
  prepareImport,
  runImporter,
} from "../tools/importers/importer";
import { logger } from "../tools/logger";
import { admin, logged, validate } from "../tools/middleware";
import { LoggedRequest } from "../tools/types";
import { router as reviewRouter } from "./importReview";

export const router = Router();
router.use(reviewRouter);
const importDir = getWithDefault("IMPORT_DIR", "/tmp/imports");
mkdirSync(importDir, { recursive: true, mode: 0o700 });
const upload = multer({
  dest: importDir,
  limits: { files: 50, fileSize: 20 * 1024 * 1024 },
});
const timezoneSchema = z.object({
  repairLegacyDeezer: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  timezone: z
    .string()
    .default("UTC")
    .refine((value) => {
      try {
        new Intl.DateTimeFormat("en", { timeZone: value });
        return true;
      } catch {
        return false;
      }
    }, "Invalid timezone"),
});

for (const type of ["privacy", "full-privacy", "deezer"] as const) {
  router.post(
    `/import/${type}`,
    logged,
    upload.array("imports", 50),
    async (req, res) => {
      const { user } = req as LoggedRequest;
      const files = ((req.files as Express.Multer.File[]) ?? []).map(
        (file) => file.path,
      );
      try {
        if (!canUserImport(user._id.toString())) {
          res.status(409).send({ code: "ALREADY_IMPORTING" });
          await Promise.all(files.map((file) => unlink(file).catch(() => {})));
          return;
        }
        const { timezone, repairLegacyDeezer } = validate(
          req.body,
          timezoneSchema,
        );
        const state = await prepareImport(
          user,
          type,
          files,
          timezone,
          repairLegacyDeezer,
        );
        res.status(200).send({ code: "IMPORT_READY", id: state._id });
      } catch (error) {
        await Promise.all(files.map((file) => unlink(file).catch(() => {})));
        logger.error("Import validation failed", error);
        res.status(400).send({ code: "IMPORT_INIT_FAILED" });
      }
    },
  );
}

const startSchema = z.object({
  existingStateId: z.string().regex(/^[a-f\d]{24}$/i),
});
for (const path of ["/import/start", "/import/retry"]) {
  router.post(path, logged, async (req, res) => {
    const { user } = req as LoggedRequest;
    const { existingStateId } = validate(req.body, startSchema);
    const state = await ImporterStateModel.findOne({
      _id: existingStateId,
      user: user._id,
      status: { $in: ["ready", "failure"] },
    });
    if (!state) {
      res.status(404).end();
      return;
    }
    if (!canUserImport(user._id.toString())) {
      res.status(409).send({ code: "ALREADY_IMPORTING" });
      return;
    }
    // Register in the running set synchronously before accepting another request.
    void runImporter(existingStateId, user).catch(logger.error);
    res.status(202).send({ code: "IMPORT_STARTED" });
  });
}

const cleanupSchema = z.object({ id: z.string().regex(/^[a-f\d]{24}$/i) });
router.delete("/import/clean/:id", logged, async (req, res) => {
  const { user } = req as LoggedRequest;
  const { id } = validate(req.params, cleanupSchema);
  const state = await ImporterStateModel.findOne({ _id: id, user: user._id });
  if (!state) {
    res.status(404).end();
    return;
  }
  if (state.status === "progress") {
    res.status(409).end();
    return;
  }
  await cleanupImport(id);
  res.status(204).end();
});
router.get("/imports", logged, async (req, res) => {
  const { user } = req as LoggedRequest;
  // Do not expose server upload paths to the browser.
  res.send(await getUserImporterState(user._id.toString()).select("-metadata"));
});
router.get("/imports/accuracy", logged, async (req, res) => {
  res.send(await listeningAccuracy((req as LoggedRequest).user));
});
router.get("/imports/backups", logged, admin, async (_req, res) => {
  res.send(await backupStatus());
});
