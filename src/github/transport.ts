import { isTauri } from "../lib/env";
import { load, save } from "../lib/storage";

export interface GithubResponse {
  status: number;
  body: unknown;
  etag?: string | null;
}

export class GithubError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

export const PRIVATE_OR_MISSING = "Private or not found. Add a GitHub token in Settings to load private repositories.";

type EtagCache = Record<string, { etag: string; body: unknown }>;

// Conditional requests: GitHub answers 304 for unchanged data, and 304s don't count
// against the rate limit, so refreshing many repositories stays cheap.
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

export function clearEtags() {
  etags = {};
  save("etags", {});
}

/**
 * Read-only GitHub GET. Inside the desktop app the request goes through the Rust side,
 * which adds the Keychain token so it never reaches the web view. In a plain browser
 * (vite dev) it falls back to an unauthenticated fetch of public data.
 */
export async function githubGet(path: string): Promise<unknown> {
  const cached = etagCache()[path];
  let res: GithubResponse;
  if (isTauri()) {
    const { invoke } = await import("@tauri-apps/api/core");
    res = await invoke<GithubResponse>("github_get", { path, etag: cached?.etag ?? null });
  } else {
    const headers: Record<string, string> = { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" };
    if (cached) headers["If-None-Match"] = cached.etag;
    const r = await fetch(`https://api.github.com${path}`, { headers });
    res = { status: r.status, etag: r.headers.get("etag"), body: r.status === 204 || r.status === 304 ? null : await r.json().catch(() => null) };
  }
  if (res.status === 304 && cached) return cached.body;
  if (res.status >= 200 && res.status < 300) {
    if (res.etag) remember(path, res.etag, res.body);
    return res.body;
  }
  const msg = (res.body as { message?: string } | null)?.message;
  if (res.status === 404) throw new GithubError(PRIVATE_OR_MISSING, 404);
  if (res.status === 403 || res.status === 429) throw new GithubError(msg ?? "Rate limited by GitHub", res.status);
  if (res.status === 401) throw new GithubError("The saved GitHub token was rejected", 401);
  throw new GithubError(msg ?? `GitHub returned ${res.status}`, res.status);
}
