import { describe, expect, it } from "vitest";
import type { Catalog } from "../catalog/types";
import type { RepoSnapshot, RepoState } from "../github/types";
import { workspaceMetrics } from "./metrics";

const NOW = Date.parse("2026-10-27T12:00:00Z");

const snap = (name: string, over: Partial<RepoSnapshot> = {}): RepoState => ({
  kind: "ok",
  stale: false,
  data: {
    fullName: name, description: null, url: "", homepage: null, language: null, languages: {}, visibility: "public",
    defaultBranch: "main", pushedAt: null, stars: 0, openIssues: 0, license: null, archived: false,
    commits: [], runs: [], workflowRuns: {}, fetchedAt: "2026-10-27T11:00:00Z", ...over,
  },
});

const run = (name: string, conclusion: string | null, createdAt: string) => ({ name, status: conclusion ? "completed" : "in_progress", conclusion, branch: "main", event: "push", createdAt, url: `u:${name}:${createdAt}` });
const commit = (date: string) => ({ sha: date, message: "m", author: "a", date, url: "" });

const catalog: Catalog = {
  projects: [{ id: "p", name: "P", summary: "", status: "active", repository: "me/p", tags: [], links: [], agentIds: [] }],
  agents: [
    { id: "a", name: "A", purpose: "", framework: "CrewAI", status: "active", lastRun: null, history: [], links: [], projectId: "p", repository: "me/p", observe: { githubWorkflow: "ci.yml" } },
    { id: "b", name: "B", purpose: "", framework: "Shell", status: "idle", lastRun: null, history: [], links: [], projectId: "p", repository: "me/p" },
  ],
};

describe("workspaceMetrics", () => {
  it("counts only runs and commits inside the window", () => {
    const repos = {
      "me/p": snap("me/p", {
        runs: [run("CI", "failure", "2026-10-27T08:00:00Z"), run("CI", "success", "2026-10-26T08:00:00Z"), run("Deploy", null, "2026-10-25T08:00:00Z"), run("CI", "success", "2026-09-01T08:00:00Z")],
        commits: [commit("2026-10-26T09:00:00Z"), commit("2026-08-01T00:00:00Z")],
      }),
    };
    const m = workspaceMetrics(catalog, repos, [], NOW);
    expect(m.runs).toEqual({ total: 3, success: 1, failure: 1, other: 1, successRate: 0.5 });
    expect(m.commits).toBe(1);
    expect(m.days).toHaveLength(14);
    expect(m.days.reduce((s, d) => s + d.success + d.failure + d.other, 0)).toBe(3);
    expect(m.failing.map((f) => f.run.name)).toEqual(["CI"]);
    expect(m.busiest).toEqual([{ repo: "me/p", project: "P", commits: 1, runs: 3 }]);
  });

  it("reports no success rate rather than inventing one", () => {
    const m = workspaceMetrics(catalog, { "me/p": { kind: "loading" } }, ["me/x"], NOW);
    expect(m.runs.successRate).toBeNull();
    expect(m.synced).toBe(0);
    expect(m.repos).toBe(2);
    expect(m.agentsByStatus.active).toBe(1);
    expect(m.observedAgents).toBe(1);
  });
});
