import type { ActionsStatus } from "./types";

export type MergeAvailability = { show: false } | { show: true; enabled: true } | { show: true; enabled: false; reason: string };

/**
 * Whether to offer merging on a repository at all. Nothing is shown until merging is switched
 * on in Settings. Even then the Merge button itself appears only for a pull request the desktop
 * app has just checked and GitHub reports ready; this only decides whether to check.
 */
export function mergeAvailability(repo: string, status: ActionsStatus | null): MergeAvailability {
  const sw = status?.config.merge_pull_requests;
  if (!status || !sw?.enabled) return { show: false };
  const r = repo.toLowerCase();
  if (!sw.repos.some((x) => x.toLowerCase() === r)) return { show: true, enabled: false, reason: "Not enabled for merges in Settings" };
  if (!(status.merge_tokens ?? []).includes(r)) return { show: true, enabled: false, reason: "Save a merge token for this repository in Settings" };
  return { show: true, enabled: true };
}
