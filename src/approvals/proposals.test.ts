import { describe, expect, it } from "vitest";
import type { ActionsStatus, AuditRecord } from "../actions/types";
import type { RepoSnapshot, RepoState, WorkflowRun } from "../github/types";
import { proposals } from "./proposals";

const NOW = Date.parse("2026-10-28T03:00:00Z");
const run = (over: Partial<WorkflowRun> = {}): WorkflowRun => ({
  id: 11, attempt: 1, name: "CI", status: "completed", conclusion: "failure", branch: "main", event: "push", createdAt: "2026-10-28T02:00:00Z",
  url: "https://github.com/me/site/actions/runs/11", ...over,
});
const repos = (runs: WorkflowRun[]): Record<string, RepoState> => ({ "me/site": { kind: "ok", data: { runs } as unknown as RepoSnapshot } as RepoState });
const status = (enabled = true, list = ["me/site"], token = true): ActionsStatus => ({ config: { rerun_failed_jobs: { enabled, repos: list }, token_login: null }, token });
const rec = (stage: AuditRecord["stage"], attempt = 1): AuditRecord => ({
  id: "a", at: "2026-10-28T02:30:00Z", stage, action: "rerun_failed_jobs", actor: "KC", github_login: null, repo: "me/site", run_id: 11, workflow: "CI",
  run_number: 4, attempt_before: attempt, head_sha: null, branch: "main", reason: null, http_status: null, request_id: null, message: null,
});
const none = new Set<string>();

describe("approval proposals", () => {
  it("proposes a re-run for a failed latest run on an enabled repository", () => {
    const ps = proposals(repos([run()]), status(), [], none, NOW);
    expect(ps).toHaveLength(1);
    expect(ps[0]).toMatchObject({ id: "rerun:me/site:11:1", agentId: "atlas-rerun-failed", repo: "me/site" });
  });

  it("proposes nothing that the action could not do", () => {
    expect(proposals(repos([run()]), status(false), [], none, NOW)).toEqual([]);
    expect(proposals(repos([run()]), status(true, []), [], none, NOW)).toEqual([]);
    expect(proposals(repos([run()]), status(true, ["me/site"], false), [], none, NOW)).toEqual([]);
    expect(proposals(repos([run()]), null, [], none, NOW)).toEqual([]);
    expect(proposals(repos([run({ conclusion: "success" })]), status(), [], none, NOW)).toEqual([]);
    expect(proposals(repos([run({ createdAt: "2026-09-01T00:00:00Z" })]), status(), [], none, NOW)).toEqual([]);
  });

  it("only looks at each workflow's latest run", () => {
    expect(proposals(repos([run({ id: 12, conclusion: "success" }), run()]), status(), [], none, NOW)).toEqual([]);
  });

  it("drops a proposal once tried from Atlas or dismissed, but asks again for a new attempt", () => {
    expect(proposals(repos([run()]), status(), [rec("attempted")], none, NOW)).toEqual([]);
    expect(proposals(repos([run()]), status(), [rec("cancelled")], none, NOW)).toHaveLength(1);
    expect(proposals(repos([run()]), status(), [], new Set(["rerun:me/site:11:1"]), NOW)).toEqual([]);
    expect(proposals(repos([run({ attempt: 2 })]), status(), [rec("started", 1)], new Set(["rerun:me/site:11:1"]), NOW)).toHaveLength(1);
  });
});
