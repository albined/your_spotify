import { LocalStorage, REMEMBER_ME_KEY } from "./storage";
import { Album, Artist, SpotifyImage } from "./types";

const NO_DATA_IMAGE = "/no_data_faded.png";
const PIXEL_RATIO = window.devicePixelRatio ?? 1;

export const getImage = (value: Artist | Album | undefined) =>
  value?.images[0]?.url || NO_DATA_IMAGE;

export function getAtLeastImage(images: SpotifyImage[], size: number) {
  const realSize = size * PIXEL_RATIO;
  const sorted = [...images].sort(
    (a, b) => a.width + a.height - (b.width + b.height),
  );
  return (
    sorted.find((s) => s.width > realSize && s.height > realSize)?.url ??
    sorted[sorted.length - 1]?.url ??
    NO_DATA_IMAGE
  );
}

export const getApiEndpoint = () =>
  (window as any as { API_ENDPOINT: string }).API_ENDPOINT;

const NO_RETURN_PATHS = ["/", "/login", "/logout"];

// Only paths of this app are accepted as a place to come back to after login
export const getReturnPath = (query: URLSearchParams) => {
  const next = query.get("next");
  return next && /^\/(?![/\\])/.test(next) ? next : undefined;
};

// The login page remembers the current page in its "next" parameter
export const getLoginPath = () => {
  const { pathname, search } = window.location;
  if (NO_RETURN_PATHS.includes(pathname)) {
    return "/login";
  }
  return `/login?next=${encodeURIComponent(pathname + search)}`;
};

export const getSpotifyLogUrl = (returnTo?: string) => {
  const query = new URLSearchParams({
    remember: String(LocalStorage.get(REMEMBER_ME_KEY) === "true"),
  });
  if (returnTo) {
    query.set("returnTo", returnTo);
  }
  return `${getApiEndpoint()}/oauth/spotify?${query}`;
};

export const compact = <T>(arr: (T | undefined)[]): T[] =>
  arr.filter((a) => a != null) as T[];

export const conditionalEntry = <T>(value: T, state: boolean) => {
  return state ? value : undefined;
};

export function uniq<T>(array: T[]) {
  const uniqd: T[] = [];
  const seen = new Set<T>();

  for (const item of array) {
    if (seen.has(item)) {
      continue;
    }
    uniqd.push(item);
    seen.add(item);
  }
  return uniqd;
}

export function noop() {}
