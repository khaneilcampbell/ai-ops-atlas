import { describe, expect, it } from "vitest";
import { opAvailability } from "./ops";
import { describeRecord, rerunAvailability } from "./rerun";
import type { ActionsStatus, AuditRecord } from "./types";

const status = (over: Partial<ActionsStatus["config"]> = {}, token = true, merge_tokens: string[] = []): ActionsStatus => ({
  config: { rerun_failed_jobs: { enabled: true, repos: ["me/site", "khaneilcampbell/ai-ops-atlas"] }, token_login: null, ...over },
  token,
  merge_tokens,
});

describe("everyday actions", () => {
  it("hides an action until it is switched on, and explains why a repository can't use it", () => {
    expect(opAvailability("cancel_runs", "me/site", status())).toEqual({ show: false });
    expect(opAvailability("cancel_runs", "me/site", null)).toEqual({ show: false });
    const on = status({ cancel_runs: { enabled: true, repos: ["Me/Site"] } });
    expect(opAvailability("cancel_runs", "me/site", on)).toEqual({ show: true, enabled: true });
    expect(opAvailability("cancel_runs", "me/other", on)).toMatchObject({ enabled: false });
    expect(opAvailability("cancel_runs", "me/site", status({ cancel_runs: { enabled: true, repos: ["me/site"] } }, false))).toMatchObject({ enabled: false, reason: "Add an Actions token in Settings" });
  });

  it("needs the repository's own token for pull request changes", () => {
    const on = { pull_request_changes: { enabled: true, repos: ["me/site"] } };
    expect(opAvailability("pull_request_changes", "me/site", status(on))).toMatchObject({ enabled: false });
    expect(opAvailability("pull_request_changes", "me/site", status(on, false, ["me/site"]))).toEqual({ show: true, enabled: true });
  });

  it("never offers to start or re-run Atlas's own workflows", () => {
    const me = "khaneilcampbell/ai-ops-atlas";
    expect(opAvailability("run_workflows", me, status({ run_workflows: { enabled: true, repos: [me] } }))).toMatchObject({ enabled: false });
    expect(opAvailability("pause_workflows", me, status({ pause_workflows: { enabled: true, repos: [me] } }))).toEqual({ show: true, enabled: true });
    const run = { id: 1, name: "Release", status: "completed", conclusion: "failure", branch: "main", event: "push", createdAt: new Date().toISOString(), url: "" };
    expect(rerunAvailability(run, me, status())).toMatchObject({ enabled: false });
  });

  it("names everyday actions in the audit log", () => {
    const base: AuditRecord = {
      id: "a", at: "2026-10-28T10:00:00Z", action: "close_pull_request", actor: "KC", github_login: null, repo: "me/site", run_id: 0, pull_number: 7, title: "Fix",
      workflow: null, run_number: null, attempt_before: null, head_sha: null, branch: null, stage: "done", reason: null, http_status: 200, request_id: null, message: null,
    };
    expect(describeRecord(base)).toMatchObject({ title: "Close pull request: Done", subject: "#7 Fix", url: "https://github.com/me/site/pull/7", result: "success" });
    expect(describeRecord({ ...base, action: "cancel_run", pull_number: null, run_id: 9, workflow: "CI", run_number: 3 })).toMatchObject({ subject: "CI #3", url: "https://github.com/me/site/actions/runs/9" });
    expect(describeRecord({ ...base, action: "pause_workflow", pull_number: null, workflow: "ci.yml" })).toMatchObject({ subject: "ci.yml", url: "https://github.com/me/site/actions/workflows/ci.yml" });
    expect(describeRecord({ ...base, action: "edit_catalog", pull_number: null, repo: "catalog/site-ci" })).toMatchObject({ subject: "site-ci" });
  });
});
