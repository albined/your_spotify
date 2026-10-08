import { Response, Router } from "express";
import { z } from "zod";

import {
  createUser,
  getUserCount,
  getUserFromField,
  storeInUser,
} from "../database";
import { HttpError } from "../tools/apis/queueHttpClient";
import { get } from "../tools/env";
import { logger } from "../tools/logger";
import {
  logged,
  validate,
  withGlobalPreferences,
  withHttpClient,
} from "../tools/middleware";
import { spotifyProvider } from "../tools/oauth/Provider";
import { isSecure, startSession } from "../tools/session";
import { GlobalPreferencesRequest, SpotifyRequest } from "../tools/types";
import { toBoolean } from "../tools/zod";

export const router = Router();

const OAUTH_COOKIE_NAME = "oauth";
const spotifyCallbackOAuthCookie = z.object({
  state: z.string(),
  remember: z.boolean().default(false),
  returnTo: z.string().optional(),
});
type OAuthCookie = z.infer<typeof spotifyCallbackOAuthCookie>;

const spotifyLogin = z.object({
  remember: z.preprocess(toBoolean, z.boolean().default(false)),
  returnTo: z.string().max(2000).optional(),
});

// Where to send the browser back to in the client. The path comes from the
// request, so anything leading outside of the client falls back to its root.
function clientUrl(path = "/") {
  const client = new URL(get("CLIENT_ENDPOINT"));
  try {
    const url = new URL(path, client);
    if (path.startsWith("/") && url.origin === client.origin) {
      return url.toString();
    }
  } catch {
    // Not a path
  }
  return client.toString();
}

router.get("/spotify", async (req, res) => {
  const { remember, returnTo } = validate(req.query, spotifyLogin);

  const isOffline = get("OFFLINE_DEV_ID");
  if (isOffline) {
    await startSession(req, res, isOffline, remember);
    // The normal Login link navigates to this endpoint. Return to the client
    // after creating the local session so offline previews never leave the
    // browser on a blank API response.
    res.redirect(clientUrl(returnTo));
    return;
  }
  const { url, state } = await spotifyProvider.getRedirect();
  const oauthCookie: OAuthCookie = { state, remember, returnTo };

  res.cookie(OAUTH_COOKIE_NAME, oauthCookie, {
    sameSite: "lax",
    httpOnly: true,
    secure: isSecure(req),
  });

  res.redirect(url);
});

type LoginError = "rate-limited" | "failed";

function redirectToLogin(res: Response, error?: LoginError) {
  res.redirect(clientUrl(error ? `/login?error=${error}` : "/login"));
}

// Spotify sends either a code, or an error when the user declines the access
const spotifyCallback = z.object({
  code: z.string().optional(),
  state: z.string().optional(),
  error: z.string().optional(),
});

router.get("/spotify/callback", withGlobalPreferences, async (req, res) => {
  const { query, globalPreferences } = req as GlobalPreferencesRequest;
  const { code, state } = validate(query, spotifyCallback);

  res.clearCookie(OAUTH_COOKIE_NAME);

  if (!code) {
    return redirectToLogin(res);
  }

  let returnTo: string | undefined;
  try {
    const cookie = spotifyCallbackOAuthCookie.parse(
      req.cookies[OAUTH_COOKIE_NAME],
    );

    if (state !== cookie.state) {
      throw new Error("State does not match");
    }

    const infos = await spotifyProvider.exchangeCode(code);
    const spotifyMe = await spotifyProvider.getMe(infos.accessToken);

    let user = await getUserFromField("spotifyId", spotifyMe.id, false);
    if (!user) {
      if (!globalPreferences.allowRegistrations) {
        return res.redirect(clientUrl("/registrations-disabled"));
      }
      const nbUsers = await getUserCount();
      user = await createUser(
        spotifyMe.display_name,
        spotifyMe.id,
        nbUsers === 0,
      );
    }
    await storeInUser("_id", user._id, infos);
    await startSession(req, res, user._id.toString(), cookie.remember);
    returnTo = cookie.returnTo;
  } catch (e) {
    logger.error(e);
    const rateLimited = e instanceof HttpError && e.status === 429;
    return redirectToLogin(res, rateLimited ? "rate-limited" : "failed");
  }
  return res.redirect(clientUrl(returnTo));
});

router.get("/spotify/me", logged, withHttpClient, async (req, res) => {
  const { client } = req as SpotifyRequest;

  try {
    const me = await client.me();
    res.status(200).send(me);
  } catch (e) {
    logger.error(e);
    res.status(500).send({ code: "SPOTIFY_ERROR" });
  }
});
