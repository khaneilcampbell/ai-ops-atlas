import { isTauri } from "../lib/env";

export interface GithubResponse {
  status: number;
  body: unknown;
}

export class GithubError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

/**
 * Read-only GitHub GET. Inside the desktop app the request goes through the Rust side,
 * which adds the Keychain token so it never reaches the web view. In a plain browser
 * (vite dev) it falls back to an unauthenticated fetch of public data.
 */
export async function githubGet(path: string): Promise<unknown> {
  let res: GithubResponse;
  if (isTauri()) {
    const { invoke } = await import("@tauri-apps/api/core");
    res = await invoke<GithubResponse>("github_get", { path });
  } else {
    const r = await fetch(`https://api.github.com${path}`, {
      headers: { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
    });
    res = { status: r.status, body: r.status === 204 ? null : await r.json().catch(() => null) };
  }
  if (res.status >= 200 && res.status < 300) return res.body;
  const msg = (res.body as { message?: string } | null)?.message;
  if (res.status === 404) throw new GithubError("Not found, or private and no token is set", 404);
  if (res.status === 403 || res.status === 429) throw new GithubError(msg ?? "Rate limited by GitHub", res.status);
  if (res.status === 401) throw new GithubError("The saved GitHub token was rejected", 401);
  throw new GithubError(msg ?? `GitHub returned ${res.status}`, res.status);
}
