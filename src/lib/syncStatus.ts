import type { RepoState } from "../github/types";

/** What the header says about the GitHub sync, from the state of every tracked repository. */
export interface SyncStatus {
  /** Newest successful fetch among the repositories, or undefined before the first one. */
  lastFetched?: string;
  /** Repositories with a snapshot to show, fresh or cached. */
  loaded: number;
  /** Repositories whose last fetch failed. Their cached snapshot, if any, is still shown. */
  failing: string[];
  /** The distinct reasons those fetches failed, most common first. */
  reasons: string[];
}

export function syncStatus(names: Iterable<string>, repos: Record<string, RepoState | undefined>): SyncStatus {
  let lastFetched: string | undefined;
  let loaded = 0;
  const failing: string[] = [];
  const counts = new Map<string, number>();
  for (const name of names) {
    const state = repos[name];
    if (!state || state.kind === "loading") continue;
    const data = state.data;
    if (data) {
      loaded++;
      if (!lastFetched || data.fetchedAt > lastFetched) lastFetched = data.fetchedAt;
    }
    if (state.kind === "error") {
      failing.push(name);
      counts.set(state.message, (counts.get(state.message) ?? 0) + 1);
    }
  }
  const reasons = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([m]) => m);
  return { lastFetched, loaded, failing, reasons };
}
