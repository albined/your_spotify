import { spotifyHttpClientFactory } from "../apis/queuedHttpClient.providers";
import { HttpError, QueuedHttpClient } from "../apis/queueHttpClient";
import { generateRandomString } from "../crypto";
import { credentials } from "./credentials";

export interface Provider {
  getRedirect(): Promise<{ url: string; state: string }>;
  exchangeCode(
    code: string,
  ): Promise<{ accessToken: string; refreshToken?: string; expiresIn: number }>;
  refresh(
    refreshToken: string,
  ): Promise<{ accessToken: string; expiresIn: number }>;
  getMe(accessToken: string): Promise<{ id: string; display_name: string }>;
  getHttpClient(accessToken: string): QueuedHttpClient;
}

const AUTH_TIMEOUT_MS = 10 * 1000;

// Logging in and refreshing tokens talk to Spotify directly rather than through
// the queue shared with imports and polling, so they neither wait behind it nor
// hang while it is paused by a rate limit.
async function authFetch(url: string, init: RequestInit) {
  const response = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(AUTH_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new HttpError({
      status: response.status,
      statusText: response.statusText,
      body: await response.text(),
    });
  }
  return response.json();
}

export class Spotify implements Provider {
  constructor(
    private readonly clientId: string,
    private readonly clientSecret: string,
    private readonly scopes: string,
    private readonly redirectUri: string,
  ) {}

  async getRedirect() {
    const authorizeUrl = new URL("https://accounts.spotify.com/authorize");
    const state = generateRandomString(32);

    authorizeUrl.searchParams.append("client_id", this.clientId);
    authorizeUrl.searchParams.append("response_type", "code");
    authorizeUrl.searchParams.append("redirect_uri", this.redirectUri);
    authorizeUrl.searchParams.append("state", state);
    authorizeUrl.searchParams.append("scope", this.scopes);

    return { url: authorizeUrl.toString(), state };
  }

  private requestToken(params: Record<string, string>) {
    return authFetch("https://accounts.spotify.com/api/token", {
      method: "post",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${Buffer.from(
          `${this.clientId}:${this.clientSecret}`,
        ).toString("base64")}`,
      },
      body: new URLSearchParams(params).toString(),
    });
  }

  async exchangeCode(code: string) {
    const data = await this.requestToken({
      grant_type: "authorization_code",
      code,
      redirect_uri: this.redirectUri,
    });

    return {
      accessToken: data.access_token as string,
      refreshToken: data.refresh_token as string | undefined,
      expiresIn: Date.now() + data.expires_in * 1000,
    };
  }

  async refresh(refresh: string) {
    const data = await this.requestToken({
      grant_type: "refresh_token",
      refresh_token: refresh,
    });

    return {
      accessToken: data.access_token as string,
      expiresIn: Date.now() + data.expires_in * 1000,
    };
  }

  getMe(accessToken: string) {
    return authFetch("https://api.spotify.com/v1/me", {
      headers: { Authorization: `Bearer ${accessToken}` },
    }) as Promise<{ id: string; display_name: string }>;
  }

  getHttpClient(accessToken: string) {
    return spotifyHttpClientFactory.createClient({
      Authorization: `Bearer ${accessToken}`,
    });
  }
}

export const spotifyProvider = new Spotify(
  credentials.spotify.public,
  credentials.spotify.secret,
  credentials.spotify.scopes,
  credentials.spotify.redirectUri,
);
