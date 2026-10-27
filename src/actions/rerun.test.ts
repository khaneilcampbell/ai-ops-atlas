import { describe, expect, it } from "vitest";
import type { WorkflowRun } from "../github/types";
import { latestPerAttempt, rerunAvailability, runId } from "./rerun";
import type { ActionsStatus, AuditRecord } from "./types";

const now = Date.parse("2026-10-27T14:00:00Z");
const failed: WorkflowRun = {
  id: 42, attempt: 1, name: "Benjaire Site CI", status: "completed", conclusion: "failure", branch: "main", event: "push",
  createdAt: "2026-10-27T12:00:00Z", url: "https://github.com/khaneilcampbell/benjaire.com/actions/runs/42",
};
const REPO = "khaneilcampbell/benjaire.com";
const on = (over: Partial<ActionsStatus["config"]["rerun_failed_jobs"]> = {}, token = true): ActionsStatus => ({
  config: { rerun_failed_jobs: { enabled: true, repos: [REPO], ...over }, token_login: "kc" },
  token,
});

describe("re-run button", () => {
  it("stays hidden until the action is switched on", () => {
    expect(rerunAvailability(failed, REPO, null, now)).toEqual({ show: false });
    expect(rerunAvailability(failed, REPO, on({ enabled: false }), now)).toEqual({ show: false });
  });

  it("only appears on finished, failed runs", () => {
    expect(rerunAvailability({ ...failed, conclusion: "success" }, REPO, on(), now).show).toBe(false);
    expect(rerunAvailability({ ...failed, status: "in_progress", conclusion: null }, REPO, on(), now).show).toBe(false);
    expect(rerunAvailability({ ...failed, conclusion: "timed_out" }, REPO, on(), now)).toEqual({ show: true, enabled: true });
  });

  it("explains why it can't be used", () => {
    const reason = (a: ReturnType<typeof rerunAvailability>) => (a.show && !a.enabled ? a.reason : null);
    expect(reason(rerunAvailability(failed, REPO, on({}, false), now))).toMatch(/token/);
    expect(reason(rerunAvailability(failed, "khaneilcampbell/other", on(), now))).toMatch(/Not enabled/);
    expect(reason(rerunAvailability({ ...failed, createdAt: "2026-09-01T00:00:00Z" }, REPO, on(), now))).toMatch(/30 days/);
    expect(reason(rerunAvailability({ ...failed, id: undefined, url: "" }, REPO, on(), now))).toMatch(/Refresh/);
  });

  it("matches repositories without regard to case", () => {
    expect(rerunAvailability(failed, REPO.toUpperCase(), on(), now)).toEqual({ show: true, enabled: true });
  });

  it("reads the run id from older cached runs' URLs", () => {
    expect(runId({ ...failed, id: undefined })).toBe(42);
    expect(runId({ ...failed, id: undefined, url: "https://github.com/a/b" })).toBeNull();
  });
});

describe("audit entries", () => {
  it("keeps the latest record of each press", () => {
    const r = (id: string, at: string, stage: AuditRecord["stage"]) => ({ id, at, stage }) as AuditRecord;
    const out = latestPerAttempt([r("a", "2026-10-27T10:00:00Z", "attempted"), r("a", "2026-10-27T10:00:02Z", "failed"), r("b", "2026-10-27T11:00:00Z", "refused")]);
    expect(out.map((x) => `${x.id}:${x.stage}`)).toEqual(["b:refused", "a:failed"]);
  });
});
