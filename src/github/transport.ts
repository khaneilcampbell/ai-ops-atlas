import { isHostedWeb, isTauri } from "../lib/env";
import { load, save } from "../lib/storage";

export interface RateLimit {
  limit: number;
  remaining: number;
  /** Unix seconds when the hourly window resets. */
  reset: number;
}

export interface GithubResponse {
  status: number;
  body: unknown;
  etag?: string | null;
  authed?: boolean;
  rate?: RateLimit | null;
}

/** Requests made since the last `takeUsage()`, and how many GitHub charged. */
export interface Usage {
  requests: number;
  counted: number;
}

export class GithubError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

const TIMEOUT_MS = 20_000;

export const PRIVATE_OR_MISSING = "Private or not found. Add a GitHub token in Settings to load private repositories.";

/** A fine-grained token whose repository access leaves this repository out. */
export const NOT_IN_TOKEN =
  "The GitHub token can't read this repository. Add it to the token's repository access, with read-only Contents, Metadata and Actions.";

type EtagCache = Record<string, { etag: string; body: unknown }>;

// Conditional requests: GitHub answers 304 for unchanged data, and with a token those
// 304s don't count against the rate limit, so refreshing many repositories stays cheap.
let etags: EtagCache | null = null;
let saveTimer: ReturnType<typeof setTimeout> | undefined;

function etagCache(): EtagCache {
  return (etags ??= load<EtagCache>("etags", {}));
}

function remember(path: string, etag: string, body: unknown) {
  etagCache()[path] = { etag, body };
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => save("etags", etags), 500);
}

let rate: RateLimit | null = load<RateLimit | null>("rate", null);
let usage: Usage = { requests: 0, counted: 0 };

/** GitHub's latest answer on the hourly budget, or null before the first request. */
export function rateLimit(): RateLimit | null {
  return rate;
}

/** True while the hourly budget is spent and the window hasn't reset yet. */
export function budgetExhausted(now = Date.now()): boolean {
  return !!rate && rate.remaining <= 0 && rate.reset * 1000 > now;
}

export function takeUsage(): Usage {
  const u = usage;
  usage = { requests: 0, counted: 0 };
  return u;
}

function resetTime(r: RateLimit) {
  return new Date(r.reset * 1000).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function track(res: GithubResponse) {
  usage.requests++;
  if (res.status !== 304 || !res.authed) usage.counted++;
  if (res.rate) {
    rate = res.rate;
    save("rate", rate);
  }
}

export function clearEtags() {
  etags = {};
  save("etags", {});
}

/**
 * Read-only GitHub GET. Inside the desktop app the request goes through the Rust side,
 * which adds the Keychain token so it never reaches the web view. The hosted web build
 * goes through its `/api/github` function, which holds the token on the server. In a
 * plain browser (vite dev) it falls back to an unauthenticated fetch of public data.
 */
export async function githubGet(path: string): Promise<unknown> {
  // Don't spend requests GitHub will refuse; wait for the window to reset instead.
  if (budgetExhausted()) throw new GithubError(`GitHub's hourly limit is used up. It resets at ${resetTime(rate!)}.`, 429);
  const cached = etagCache()[path];
  let res: GithubResponse;
  if (isTauri()) {
    const { invoke } = await import("@tauri-apps/api/core");
    res = await invoke<GithubResponse>("github_get", { path, etag: cached?.etag ?? null });
  } else {
    const headers: Record<string, string> = { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" };
    if (cached) headers["If-None-Match"] = cached.etag;
    const web = isHostedWeb();
    // The desktop app's Rust client gives up after the same time, so a hung request can't
    // hold a refresh open forever in the browser either.
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), TIMEOUT_MS);
    try {
      const r = await fetch(web ? `/api/github${path}` : `https://api.github.com${path}`, { headers, credentials: web ? "same-origin" : "omit", signal: abort.signal });
      const num = (h: string) => Number(r.headers.get(h) ?? NaN);
      const limit = { limit: num("x-ratelimit-limit"), remaining: num("x-ratelimit-remaining"), reset: num("x-ratelimit-reset") };
      const body = r.status === 204 || r.status === 304 ? null : await r.json().catch(() => null);
      // The site's proxy marks every answer it relays from GitHub. One without the mark came
      // from the site itself (sign-in check, allowlist, outage), so its own message applies.
      if (web && !r.headers.has("x-atlas-authed") && !r.ok) {
        const msg = (body as { message?: string } | null)?.message;
        throw new GithubError(msg ? `The site refused the request: ${msg}` : `The site's GitHub proxy returned ${r.status}.`, r.status);
      }
      res = {
        status: r.status,
        etag: r.headers.get("etag"),
        authed: r.headers.get("x-atlas-authed") === "1",
        rate: Object.values(limit).every(Number.isFinite) ? limit : null,
        body,
      };
    } catch (e) {
      if (e instanceof GithubError) throw e;
      if (abort.signal.aborted) throw new GithubError(`GitHub didn't answer within ${TIMEOUT_MS / 1000} seconds.`, 0);
      throw new GithubError(web ? "Couldn't reach the site's GitHub proxy. Check the connection, or reload to sign in again." : "Couldn't reach GitHub. Check the connection.", 0);
    } finally {
      clearTimeout(timer);
    }
  }
  track(res);
  if (res.status === 304 && cached) return cached.body;
  if (res.status >= 200 && res.status < 300) {
    if (res.etag) remember(path, res.etag, res.body);
    return res.body;
  }
  const msg = (res.body as { message?: string } | null)?.message;
  if (res.status === 404) throw new GithubError(PRIVATE_OR_MISSING, 404);
  if ((res.status === 403 || res.status === 429) && res.rate?.remaining === 0)
    throw new GithubError(`GitHub's hourly limit is used up. It resets at ${resetTime(res.rate)}.`, res.status);
  if (res.status === 403 && msg?.startsWith("Resource not accessible by personal access token")) throw new GithubError(NOT_IN_TOKEN, 403);
  if (res.status === 403 || res.status === 429) throw new GithubError(msg ?? "Rate limited by GitHub", res.status);
  if (res.status === 401) throw new GithubError("The saved GitHub token was rejected", 401);
  throw new GithubError(msg ?? `GitHub returned ${res.status}`, res.status);
}
