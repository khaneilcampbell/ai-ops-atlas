import { describe, expect, it } from "vitest";
import type { Catalog } from "../catalog/types";
import type { RepoState } from "../github/types";
import { filterEvents, workspaceEvents } from "./activity";

const run = (name: string, conclusion: string | null, createdAt: string) => ({ name, status: conclusion ? "completed" : "in_progress", conclusion, branch: "main", event: "push", createdAt, url: `u:${name}:${createdAt}` });

const catalog: Catalog = {
  projects: [{ id: "p", name: "P", summary: "", status: "active", repository: "me/p", tags: [], links: [], agentIds: ["a"] }],
  agents: [
    {
      id: "a", name: "Auditor", purpose: "", framework: "GitHub Actions", status: "active", lastRun: null,
      history: [{ at: "2026-10-01T00:00:00.000Z", event: "Added" }], links: [], projectId: "p", repository: "me/p", observe: { githubWorkflow: "audit.yml" },
    },
  ],
};

const shared = run("Audit", "failure", "2026-10-26T10:00:00Z");
const repos: Record<string, RepoState> = {
  "me/p": {
    kind: "ok",
    stale: false,
    data: {
      fullName: "me/p", description: null, url: "", homepage: null, language: null, languages: {}, visibility: "public", defaultBranch: "main",
      pushedAt: null, stars: 0, openIssues: 0, license: null, archived: false,
      commits: [{ sha: "abcdef123", message: "Fix\n\nbody", author: "kc", date: "2026-10-26T12:00:00Z", url: "c" }],
      runs: [shared, run("CI", null, "2026-10-26T11:00:00Z")],
      workflowRuns: { "audit.yml": [shared] },
      fetchedAt: "2026-10-27T00:00:00Z",
    },
  },
};

describe("workspaceEvents", () => {
  const events = workspaceEvents(catalog, repos);

  it("attributes a declared workflow's runs to its agent once", () => {
    const audit = events.filter((e) => e.url === shared.url);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ kind: "agent", agentId: "a", result: "failure" });
  });

  it("includes commits, CI and manifest history, newest first", () => {
    expect(events.map((e) => e.kind)).toEqual(["commit", "ci", "agent", "manifest"]);
    expect(events[0].title).toBe("Fix");
    expect(events[1].result).toBe("running");
  });

  it("filters by kind, result, time and text", () => {
    const now = Date.parse("2026-10-27T00:00:00Z");
    const base = { kinds: [], project: "", result: "" as const, sinceMs: null, query: "" };
    expect(filterEvents(events, { ...base, kinds: ["ci", "agent"] }, now)).toHaveLength(2);
    expect(filterEvents(events, { ...base, result: "failure" }, now)).toHaveLength(1);
    expect(filterEvents(events, { ...base, sinceMs: 7 * 86_400_000 }, now)).toHaveLength(3);
    expect(filterEvents(events, { ...base, query: "fix" }, now)).toHaveLength(1);
  });
});

describe("intelligence runs", () => {
  it("adds repository intelligence runs with their result and cost", () => {
    const run = {
      id: "r1", repo: "me/p", trigger: "manual", depth: "standard", model: "claude-x", force: false, status: "failed",
      queued_at: "2026-10-26T13:00:00Z", started_at: "2026-10-26T13:00:01Z", finished_at: null, duration_ms: null, error: null,
      attempts: 1, github_requests: 3, usage: null, estimate: null, cost_usd: 0.0123, trace: [],
    } as const;
    const e = workspaceEvents(catalog, repos, [], [run]).find((x) => x.kind === "intel")!;
    expect(e).toMatchObject({ result: "failure", projectId: "p", at: "2026-10-26T13:00:01Z" });
    expect(e.detail).toContain("$0.012");
  });
});

describe("approval-required actions", () => {
  it("shows each press once, with its latest outcome", () => {
    const base = {
      id: "x1", action: "rerun_failed_jobs", actor: "kc (Atlas desktop)", github_login: "kc", repo: "me/p", run_id: 42, workflow: "CI", run_number: 7,
      attempt_before: 1, head_sha: "abc", branch: "main", reason: null, http_status: null, request_id: null, message: null,
    };
    const log = [
      { ...base, at: "2026-10-26T14:00:00Z", stage: "attempted" as const },
      { ...base, at: "2026-10-26T14:00:01Z", stage: "started" as const, http_status: 201 },
      { ...base, id: "x2", at: "2026-10-26T15:00:00Z", stage: "cancelled" as const, message: "Cancelled. Nothing was sent to GitHub." },
    ];
    const events = workspaceEvents(catalog, repos, [], [], log).filter((x) => x.kind === "action");
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ title: "Re-run failed jobs: Cancelled", result: "other" });
    expect(events[1]).toMatchObject({ title: "Re-run failed jobs: Started", result: "success", projectId: "p", url: "https://github.com/me/p/actions/runs/42" });
    expect(events[1].detail).toContain("CI #7");
  });
});
