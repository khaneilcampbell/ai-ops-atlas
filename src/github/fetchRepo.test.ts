import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RepoSnapshot } from "./types";

const calls: string[] = [];
let responses: Record<string, unknown> = {};

vi.mock("./transport", () => ({
  GithubError: class extends Error {
    constructor(
      m: string,
      public status: number,
    ) {
      super(m);
    }
  },
  githubGet: async (path: string) => {
    calls.push(path);
    const key = Object.keys(responses)
      .filter((k) => path.startsWith(k))
      .sort((a, b) => b.length - a.length)[0];
    return key ? responses[key] : path.includes("/commits") ? [] : {};
  },
}));

const { fetchRepo, syncPlan } = await import("./fetchRepo");

const meta = { full_name: "o/r", default_branch: "main", pushed_at: "2026-10-27T09:00:00Z", html_url: "https://github.com/o/r" };
const run = (over: Record<string, unknown> = {}) => ({
  name: "CI",
  status: "completed",
  conclusion: "success",
  head_branch: "main",
  event: "push",
  created_at: "2026-10-27T09:01:00Z",
  html_url: "u",
  path: ".github/workflows/ci.yml",
  ...over,
});

function snapshot(over: Partial<RepoSnapshot> = {}): RepoSnapshot {
  return {
    fullName: "o/r", description: null, url: "", homepage: null, language: null, languages: { TS: 1 }, visibility: "public",
    defaultBranch: "main", pushedAt: meta.pushed_at, stars: 0, openIssues: 0, license: null, archived: false,
    commits: [{ sha: "a", message: "m", author: "kc", date: meta.pushed_at, url: "" }], runs: [], workflowRuns: { "ci.yml": [] },
    fetchedAt: "2026-10-27T09:30:00Z", runsCheckedAt: "2026-10-27T09:30:00Z", ...over,
  };
}

const now = Date.parse("2026-10-27T10:00:00Z");

beforeEach(() => {
  calls.length = 0;
  responses = { "/repos/o/r/actions/runs": { workflow_runs: [run(), run({ path: ".github/workflows/deploy.yml", name: "Deploy" })] } };
});

describe("syncPlan", () => {
  it("asks for everything the first time", () => {
    expect(syncPlan(undefined, meta, { runsEveryMs: 0, now })).toEqual({ details: true, runs: true });
  });

  it("reuses commits and languages when nothing was pushed", () => {
    expect(syncPlan(snapshot(), meta, { runsEveryMs: 3_600_000, now })).toEqual({ details: false, runs: false });
  });

  it("refetches details after a push", () => {
    expect(syncPlan(snapshot(), { ...meta, pushed_at: "2026-10-27T09:50:00Z" }, { runsEveryMs: 3_600_000, now }).details).toBe(true);
  });

  it("keeps checking runs that haven't finished", () => {
    const prev = snapshot({ runs: [{ name: "CI", status: "in_progress", conclusion: null, branch: "main", event: "push", createdAt: "", url: "" }] });
    expect(syncPlan(prev, meta, { runsEveryMs: 3_600_000, now }).runs).toBe(true);
  });

  it("checks runs of an unchanged repo once the interval has passed", () => {
    expect(syncPlan(snapshot({ runsCheckedAt: "2026-10-27T08:00:00Z" }), meta, { runsEveryMs: 3_600_000, now }).runs).toBe(true);
  });
});

describe("fetchRepo", () => {
  it("uses listing metadata and one run list for CI and observed workflows", async () => {
    const snap = await fetchRepo("o/r", ["ci.yml", "deploy.yml"], { meta, runsEveryMs: 0, now });
    expect(calls.sort()).toEqual(["/repos/o/r/actions/runs?per_page=30", "/repos/o/r/commits?per_page=10&sha=main", "/repos/o/r/languages"]);
    expect(snap.runs).toHaveLength(2);
    expect(snap.workflowRuns["deploy.yml"]).toHaveLength(1);
  });

  it("asks only for a workflow the run list doesn't show", async () => {
    await fetchRepo("o/r", ["codeql.yml"], { meta, runsEveryMs: 0, now });
    expect(calls).toContain("/repos/o/r/actions/workflows/codeql.yml/runs?per_page=5");
  });

  it("makes no requests for an unchanged repository between run checks", async () => {
    const prev = snapshot();
    const snap = await fetchRepo("o/r", ["ci.yml"], { meta, prev, runsEveryMs: 3_600_000, now });
    expect(calls).toEqual([]);
    expect(snap.commits).toBe(prev.commits);
    expect(snap.runsCheckedAt).toBe(prev.runsCheckedAt);
  });

  it("checks only runs for an unchanged repository when runs are due", async () => {
    await fetchRepo("o/r", ["ci.yml"], { meta, prev: snapshot(), runsEveryMs: 0, now });
    expect(calls).toEqual(["/repos/o/r/actions/runs?per_page=30"]);
  });

  it("fetches the repository itself when no listing metadata is available", async () => {
    responses["/repos/o/r"] = meta;
    responses["/repos/o/r/commits"] = [];
    responses["/repos/o/r/languages"] = {};
    responses["/repos/o/r/actions/runs"] = { workflow_runs: [] };
    await fetchRepo("o/r", [], { runsEveryMs: 0, now });
    expect(calls[0]).toBe("/repos/o/r");
  });
});
