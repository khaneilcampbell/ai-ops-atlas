import { describe, expect, it } from "vitest";
import type { RepoSnapshot, RepoState } from "../github/types";
import { syncStatus } from "./syncStatus";

const snap = (fetchedAt: string): RepoSnapshot => ({
  fullName: "me/a", description: null, url: "", homepage: null, language: null, languages: {}, visibility: "public",
  defaultBranch: "main", pushedAt: null, stars: 0, openIssues: 0, license: null, archived: false,
  commits: [], runs: [], workflowRuns: {}, fetchedAt,
});

describe("syncStatus", () => {
  it("reports the newest fetch and no failures when every repository synced", () => {
    const repos: Record<string, RepoState> = {
      "me/a": { kind: "ok", data: snap("2026-11-08T10:00:00Z"), stale: false },
      "me/b": { kind: "ok", data: snap("2026-11-08T11:00:00Z"), stale: false },
    };
    expect(syncStatus(["me/a", "me/b"], repos)).toEqual({ lastFetched: "2026-11-08T11:00:00Z", loaded: 2, failing: [], reasons: [] });
  });

  it("counts a failed repository with a cached copy as loaded but also as failing", () => {
    const rejected = "The saved GitHub token was rejected";
    const repos: Record<string, RepoState> = {
      "me/a": { kind: "error", message: rejected, data: snap("2026-11-03T09:00:00Z") },
      "me/b": { kind: "error", message: rejected, data: snap("2026-11-03T08:00:00Z") },
      "me/c": { kind: "error", message: "GitHub returned 502" },
    };
    const s = syncStatus(["me/a", "me/b", "me/c"], repos);
    expect(s.lastFetched).toBe("2026-11-03T09:00:00Z");
    expect(s.loaded).toBe(2);
    expect(s.failing).toEqual(["me/a", "me/b", "me/c"]);
    expect(s.reasons).toEqual([rejected, "GitHub returned 502"]);
  });

  it("ignores repositories still loading or not tracked", () => {
    const repos: Record<string, RepoState> = {
      "me/a": { kind: "loading" },
      "me/other": { kind: "error", message: "x" },
    };
    expect(syncStatus(["me/a", "me/missing"], repos)).toEqual({ lastFetched: undefined, loaded: 0, failing: [], reasons: [] });
  });
});
