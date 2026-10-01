import { Router } from "express";
import { z } from "zod";

import {
  getReviewRows,
  listReviewGroups,
} from "../database/queries/importReview";
import {
  applyReview,
  applyTimingChoice,
  chooseNoMatch,
  previewReview,
  reviewTiming,
} from "../tools/importers/review";
import {
  reviewCandidates,
  spotifyTrackId,
} from "../tools/importers/reviewCatalog";
import { logged, validate } from "../tools/middleware";
import { LoggedRequest } from "../tools/types";

export const router = Router();
const category = z
  .enum(["recording", "legacy", "timestamp", "invalid", "no-match"])
  .default("recording");
const group = z.string().regex(/^[a-f0-9]{64}$/);
const selection = z.object({ group, track: z.string().trim().min(1).max(500) });
router.get("/imports/review/timing", logged, async (req, res) => {
  const query = validate(req.query, z.object({ group }));
  try {
    res.send(await reviewTiming((req as LoggedRequest).user, query.group));
  } catch (error) {
    res
      .status(409)
      .send({
        message:
          error instanceof Error
            ? error.message
            : "Could not load the comparison",
      });
  }
});
router.post("/imports/review/timing", logged, async (req, res) => {
  const objectId = z.string().regex(/^[a-f0-9]{24}$/);
  const value = validate(
    req.body,
    z.object({
      group,
      rowId: objectId,
      token: z.string().regex(/^[a-f0-9]{64}$/),
      existingId: objectId.nullable(),
      exclude: z.boolean().optional(),
    }),
  );
  try {
    res.send(
      await applyTimingChoice(
        (req as LoggedRequest).user,
        value.group,
        value.rowId,
        value.token,
        value.existingId,
        value.exclude,
      ),
    );
  } catch (error) {
    res
      .status(409)
      .send({
        message:
          error instanceof Error
            ? error.message
            : "Could not save the timing choice",
      });
  }
});
for (const action of ["no-match", "reopen"] as const) {
  router.post(`/imports/review/${action}`, logged, async (req, res) => {
    const value = validate(req.body, z.object({ group }));
    try {
      res.send(
        await chooseNoMatch(
          (req as LoggedRequest).user,
          value.group,
          action === "reopen",
        ),
      );
    } catch (error) {
      res
        .status(409)
        .send({
          message:
            error instanceof Error
              ? error.message
              : "Could not save this choice",
        });
    }
  });
}
router.get("/imports/review", logged, async (req, res) => {
  const query = validate(req.query, z.object({ category }));
  res.send(await listReviewGroups((req as LoggedRequest).user, query.category));
});
router.get("/imports/review/rows", logged, async (req, res) => {
  const query = validate(
    req.query,
    z.object({
      category,
      group,
      offset: z.coerce.number().int().min(0).default(0),
    }),
  );
  res.send(
    await getReviewRows(
      (req as LoggedRequest).user,
      query.category,
      query.group,
      query.offset,
    ),
  );
});
router.get("/imports/review/candidates", logged, async (req, res) => {
  const query = validate(
    req.query,
    z.object({ query: z.string().trim().min(1).max(160) }),
  );
  res.send(
    await reviewCandidates(
      (req as LoggedRequest).user._id.toString(),
      query.query,
    ),
  );
});
router.post("/imports/review/preview", logged, async (req, res) => {
  const value = validate(req.body, selection);
  try {
    res.send(
      await previewReview(
        (req as LoggedRequest).user,
        value.group,
        spotifyTrackId(value.track),
      ),
    );
  } catch (error) {
    res
      .status(409)
      .send({
        message:
          error instanceof Error
            ? error.message
            : "Could not preview this choice",
      });
  }
});
router.post("/imports/review/apply", logged, async (req, res) => {
  const value = validate(
    req.body,
    selection.extend({
      token: z
        .string()
        .regex(/^[a-f0-9]{64}$/)
        .optional(),
    }),
  );
  try {
    res.send(
      await applyReview(
        (req as LoggedRequest).user,
        value.group,
        spotifyTrackId(value.track),
        value.token,
      ),
    );
  } catch (error) {
    res
      .status(409)
      .send({
        message:
          error instanceof Error
            ? error.message
            : "Could not apply this choice; refresh and retry",
      });
  }
});
