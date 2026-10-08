import { Request, Response } from "express";
import { decode, sign, verify } from "jsonwebtoken";

import { getPrivateData } from "../database/queries/privateData";
import { get, getWithDefault } from "./env";

const SESSION_COOKIE_NAME = "token";

export interface Session {
  userId: string;
  remember?: boolean;
  iat: number;
  exp: number;
}

async function getJwtKey() {
  const privateData = await getPrivateData();
  if (!privateData?.jwtPrivateKey) {
    throw new Error("No private data found, cannot sign JWT");
  }
  return privateData.jwtPrivateKey;
}

// req.secure is false behind a proxy terminating TLS, the public endpoint
// tells whether the browser reaches the API over https.
export function isSecure(req: Request) {
  return req.secure || get("API_ENDPOINT").startsWith("https://");
}

export async function startSession(
  req: Request,
  res: Response,
  userId: string,
  remember: boolean,
) {
  const token = sign({ userId, remember }, await getJwtKey(), {
    expiresIn: getWithDefault("COOKIE_VALIDITY_MS", "30d") as `${number}`,
  });
  const { exp } = decode(token) as Session;

  res.cookie(SESSION_COOKIE_NAME, token, {
    sameSite: "strict",
    httpOnly: true,
    secure: isSecure(req),
    // Without "remember me" the cookie ends with the browser session
    expires: remember ? new Date(exp * 1000) : undefined,
  });
}

export async function readSession(req: Request) {
  const token = req.cookies[SESSION_COOKIE_NAME];
  if (!token) {
    return null;
  }
  const session = verify(token, await getJwtKey()) as Session;
  if (typeof session.userId !== "string") {
    return null;
  }
  return session;
}

// Sessions slide: one used in the second half of its validity is replaced by
// a fresh one, so a login only ends after a full validity period of inactivity.
export async function renewSession(
  req: Request,
  res: Response,
  session: Session,
) {
  if (Date.now() / 1000 < (session.iat + session.exp) / 2) {
    return;
  }
  await startSession(req, res, session.userId, session.remember === true);
}

export function endSession(res: Response) {
  res.clearCookie(SESSION_COOKIE_NAME);
}
