import { describe, expect, it } from "vitest";
import { mergeAvailability } from "./merge";
import { describeRecord } from "./rerun";
import type { ActionsStatus, AuditRecord } from "./types";

const REPO = "khaneilcampbell/benjaire.com";
const status = (enabled = true, repos = [REPO], tokens = [REPO.toLowerCase()]): ActionsStatus => ({
  config: { rerun_failed_jobs: { enabled: true, repos: [REPO] }, token_login: null, merge_pull_requests: { enabled, repos, token_logins: {} } },
  token: true,
  merge_tokens: tokens,
});

describe("merge availability", () => {
  it("shows nothing until merging is switched on, whatever the re-run switch says", () => {
    expect(mergeAvailability(REPO, null)).toEqual({ show: false });
    expect(mergeAvailability(REPO, status(false))).toEqual({ show: false });
    const old = { config: { rerun_failed_jobs: { enabled: true, repos: [REPO] }, token_login: null }, token: true } as ActionsStatus;
    expect(mergeAvailability(REPO, old)).toEqual({ show: false });
  });

  it("needs the repository ticked and its own token", () => {
    expect(mergeAvailability(REPO.toUpperCase(), status())).toEqual({ show: true, enabled: true });
    expect(mergeAvailability(REPO, status(true, []))).toMatchObject({ enabled: false, reason: expect.stringMatching(/Not enabled/) });
    expect(mergeAvailability(REPO, status(true, [REPO], ["khaneilcampbell/other"]))).toMatchObject({ enabled: false, reason: expect.stringMatching(/token/) });
  });
});

describe("audit records", () => {
  const base = { id: "a", at: "2026-10-28T09:00:00Z", actor: "kc", github_login: null, repo: REPO, workflow: null, run_number: null, attempt_before: null, head_sha: null, branch: null, reason: null, http_status: null, request_id: null, message: null };
  it("names merges by pull request and re-runs by run", () => {
    const m = describeRecord({ ...base, action: "merge_pull_request", run_id: 0, pull_number: 7, title: "Fix footer", stage: "merged" } as AuditRecord);
    expect(m).toEqual({ title: "Merge pull request: Merged", subject: "#7 Fix footer", url: `https://github.com/${REPO}/pull/7`, result: "success" });
    const r = describeRecord({ ...base, action: "rerun_failed_jobs", run_id: 42, workflow: "CI", run_number: 3, stage: "failed" } as AuditRecord);
    expect(r).toMatchObject({ subject: "CI #3", url: `https://github.com/${REPO}/actions/runs/42`, result: "failure" });
  });
});
