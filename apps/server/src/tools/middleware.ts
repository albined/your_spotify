import { hrtime } from "process";

import { NextFunction, Request, Response } from "express";
import { Types } from "mongoose";
import { z } from "zod";

import { getUserFromField, getGlobalPreferences } from "../database";
import { getUserImporterState } from "../database/queries/importer";
import { SpotifyAPI } from "./apis/spotifyApi";
import { YourSpotifyError } from "./errors/error";
import { logger } from "./logger";
import { Metrics } from "./metrics";
import { readSession, renewSession } from "./session";
import {
  GlobalPreferencesRequest,
  LoggedRequest,
  OptionalLoggedRequest,
  SpotifyRequest,
} from "./types";

export class ValidationError extends YourSpotifyError {
  type = "MALFORMED" as const;

  constructor(validationError: Error) {
    super("Validation error", { cause: validationError });
  }
}

class NotLoggedError extends YourSpotifyError {
  type = "UNAUTHORIZED" as const;
  code = "NOT_LOGGED";
}

class NotAdminError extends YourSpotifyError {
  type = "FORBIDDEN" as const;
  code = "NOT_ADMIN";
}

export const validate = <
  Z extends z.ZodObject | z.ZodDiscriminatedUnion<any, any>,
>(
  payload: any,
  schema: Z,
): z.infer<Z> => {
  try {
    let value;
    if ("extend" in schema) {
      value = schema.extend({ token: z.string().optional() }).parse(payload);
    } else {
      value = schema
        .and(z.object({ token: z.string().optional() }))
        .parse(payload);
    }
    return value;
  } catch (e) {
    logger.error(e);
    throw new ValidationError(e);
  }
};

const baselogged = async (
  req: Request,
  res: Response,
  useQueryToken = false,
) => {
  const { token: queryToken } = req.query;

  if (useQueryToken && queryToken && typeof queryToken === "string") {
    const user = await getUserFromField("publicToken", queryToken, false);
    if (user) {
      return user;
    }
  }

  try {
    const session = await readSession(req);
    if (!session) {
      return null;
    }

    const user = await getUserFromField(
      "_id",
      new Types.ObjectId(session.userId),
      false,
    );

    if (!user) {
      return null;
    }
    await renewSession(req, res, session);
    return user;
  } catch {
    return null;
  }
};

export const logged = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  const user = await baselogged(req, res, false);
  if (!user) {
    throw new NotLoggedError();
  }
  (req as LoggedRequest).user = user;
  next();
};

export const isLoggedOrGuest = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  const user = await baselogged(req, res, true);
  if (!user) {
    throw new NotLoggedError();
  }
  (req as LoggedRequest).user = user;
  next();
};

export const optionalLoggedOrGuest = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  const user = await baselogged(req, res, true);
  (req as OptionalLoggedRequest).user = user;
  next();
};

export const optionalLogged = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  const user = await baselogged(req, res, false);
  (req as OptionalLoggedRequest).user = user;
  next();
};

export const admin = (req: Request, res: Response, next: NextFunction) => {
  const { user } = req as LoggedRequest;

  if (!user) {
    throw new NotLoggedError();
  }

  if (!user.admin) {
    throw new NotAdminError();
  }
  next();
};

export const withHttpClient = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  const { user } = req as LoggedRequest;

  const client = new SpotifyAPI(user._id.toString());
  (req as SpotifyRequest & LoggedRequest).client = client;
  next();
};

export const withGlobalPreferences = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const pref = await getGlobalPreferences();
    if (!pref) {
      logger.error(
        "No global preferences, this is critical, try restarting the app",
      );
      return;
    }
    (req as GlobalPreferencesRequest).globalPreferences = pref;
    next();
  } catch {
    res.status(500).end();
  }
};

class AlreadyImportingError extends YourSpotifyError {
  type = "CONFLICT" as const;
  code = "ALREADY_IMPORTING";
}

export const notAlreadyImporting = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  const { user } = req as LoggedRequest;
  const imports = await getUserImporterState(user._id.toString());
  if (imports.some((imp) => imp.status === "progress")) {
    throw new AlreadyImportingError();
  }
  next();
};

const MEASURE_METHODS = ["GET", "POST", "PATCH", "PUT", "DELETE"];

export const measureRequestDuration = (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  if (!MEASURE_METHODS.includes(req.method)) {
    return next();
  }
  const endpoint = req.path;
  const start = hrtime.bigint();
  res.on("finish", () => {
    const duration = Number(hrtime.bigint() - start);
    Metrics.httpRequestDurationNanoseconds
      .labels(req.method, endpoint, res.statusCode.toString())
      .set(duration);
    Metrics.httpRequestsTotal
      .labels(req.method, endpoint, res.statusCode.toString())
      .inc();
  });
  next();
};

class AffinityNotAllowedError extends YourSpotifyError {
  type = "UNAUTHORIZED" as const;
  code = "AFFINITY_NOT_ALLOWED";

  constructor() {
    super("Affinity is not allowed");
  }
}

export const affinityAllowed = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  const globalPreferences = await getGlobalPreferences();
  if (!globalPreferences?.allowAffinity) {
    throw new AffinityNotAllowedError();
  }
  next();
};
