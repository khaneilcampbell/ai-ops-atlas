import { describe, expect, it } from "vitest";
import type { RepoSnapshot } from "../github/types";
import { applyGithubEvent, describe as describeEvent, mergeAgentRuns, toAgentRun, upsertRun, type LiveEvent } from "./apply";

const snap = (over: Partial<RepoSnapshot> = {}): RepoSnapshot => ({
  fullName: "o/r", description: null, url: "", homepage: null, language: null, languages: {}, visibility: "public", defaultBranch: "main",
  pushedAt: null, stars: 0, openIssues: 0, license: null, archived: false,
  commits: [{ sha: "old", message: "m", author: "kc", date: "2026-10-27T00:00:00Z", url: "" }],
  runs: [{ id: 1, attempt: 1, name: "CI", status: "completed", conclusion: "success", branch: "main", event: "push", createdAt: "2026-10-27T00:00:00Z", url: "https://g/1" }],
  workflowRuns: { "ci.yml": [] }, fetchedAt: "2026-10-27T00:00:00Z", ...over,
});
const runEvent = (status: string, over: Record<string, unknown> = {}): LiveEvent => ({
  id: 1, at: "t", source: "github", kind: "workflow_run", repo: "o/r",
  body: { run: { id: 2, run_attempt: 1, name: "CI", path: ".github/workflows/ci.yml", status, conclusion: status === "completed" ? "failure" : null, head_branch: "main", event: "push", created_at: "2026-10-28T00:00:00Z", html_url: "https://g/2", ...over } },
});

describe("live events", () => {
  it("shows a new run as running, then finished, in both lists", () => {
    let s = applyGithubEvent(snap(), runEvent("in_progress"));
    expect(s.runs[0]).toMatchObject({ id: 2, status: "in_progress" });
    expect(s.workflowRuns["ci.yml"]).toHaveLength(1);
    s = applyGithubEvent(s, runEvent("completed"));
    expect(s.runs[0]).toMatchObject({ id: 2, status: "completed", conclusion: "failure" });
    expect(s.runs).toHaveLength(2);
  });

  it("never moves a run backwards when deliveries arrive out of order", () => {
    const done = applyGithubEvent(snap(), runEvent("completed"));
    expect(applyGithubEvent(done, runEvent("in_progress"))).toBe(done);
    // A re-run is a newer attempt, so it does go back to running.
    expect(applyGithubEvent(done, runEvent("in_progress", { run_attempt: 2 })).runs[0]).toMatchObject({ attempt: 2, status: "in_progress" });
  });

  it("leaves other branches out of the default branch's runs", () => {
    const s = snap({ workflowRuns: {} });
    expect(applyGithubEvent(s, runEvent("in_progress", { head_branch: "feature" }))).toBe(s);
  });

  it("adds pushed commits to the default branch, newest first", () => {
    const e: LiveEvent = { id: 2, at: "t", source: "github", kind: "push", repo: "o/r", body: { branch: "main", deleted: false, commits: [{ sha: "a", message: "one" }, { sha: "b", message: "two" }] } };
    expect(applyGithubEvent(snap(), e).commits.map((c) => c.sha)).toEqual(["b", "a", "old"]);
  });

  it("drops runs older than a full list", () => {
    const list = [{ id: 9, name: "x", status: "completed", conclusion: "success", branch: "main", event: "push", createdAt: "2026-10-28T00:00:00Z", url: "u9" }];
    expect(upsertRun(list, { ...list[0], id: 8, url: "u8", createdAt: "2026-10-01T00:00:00Z" }, 1)).toBeNull();
  });

  it("describes what happened in a few words", () => {
    expect(describeEvent(runEvent("completed"))).toBe("CI failed · r");
    expect(describeEvent(runEvent("in_progress"))).toBe("CI running · r");
  });

  it("keeps each pipeline run once, newest first", () => {
    const ev = (id: number, at: string, body: Record<string, unknown> = {}): LiveEvent => ({ id, at, source: "agent", kind: "agent_run", repo: null, body: { project: "commerce-pipeline", agents: ["sales-sync"], phase: "Sales sync", status: "ok", detail: "", at, ...body } });
    expect(describeEvent(ev(1, "2026-10-28T01:00:00Z", { status: "failed" }))).toBe("Sales sync failed · commerce-pipeline");
    expect(toAgentRun(ev(1, "t", { status: "deleted" }))).toBeNull();
    expect(toAgentRun({ ...ev(1, "t"), kind: "push" })).toBeNull();
    const a = toAgentRun(ev(1, "2026-10-28T01:00:00Z"))!;
    const b = toAgentRun(ev(2, "2026-10-28T02:00:00Z"))!;
    const list = mergeAgentRuns([a], [b, a]);
    expect(list.map((r) => r.id)).toEqual([2, 1]);
    expect(mergeAgentRuns(list, [a])).toBe(list);
    expect(mergeAgentRuns([], [a, b], 1).map((r) => r.id)).toEqual([2]);
  });
});
