import { describe, expect, it } from "vitest";
import type { WorkflowRun } from "../github/types";
import { releaseSummary, workSummary } from "./production";

const run = (over: Partial<WorkflowRun>): WorkflowRun => ({ name: "CI", status: "completed", conclusion: "success", branch: "main", event: "push", createdAt: "2026-11-16T10:00:00Z", url: `https://github.com/r/${Math.random()}`, ...over });

describe("production panel numbers", () => {
  it("counts failing work and sends that need a person to check them", () => {
    const s = workSummary([{ status: "failed" }, { status: "running" }, { status: "awaiting_approval" }, { status: "failed" }], [{ needsReconcile: { a: "x", b: "y" } }, { needsReconcile: {} }]);
    expect(s).toEqual({ failed: 2, running: 1, awaitingApproval: 1, blocked: 0, needsReconcile: 2 });
  });

  it("reads Atlas's CI on main, newest first, and ignores pull requests and other workflows", () => {
    const r = releaseSummary([
      run({ createdAt: "2026-11-16T09:00:00Z", conclusion: "failure" }),
      run({ createdAt: "2026-11-16T11:00:00Z" }),
      run({ createdAt: "2026-11-16T12:00:00Z", event: "pull_request", conclusion: "failure" }),
      run({ name: "Visual", createdAt: "2026-11-16T12:30:00Z", conclusion: "failure" }),
    ]);
    expect(r.state).toBe("passing");
    expect(r.history).toHaveLength(2);
    expect(r.successRate).toBe(0.5);
  });

  it("is unknown with no synced runs, and running while the latest build is in progress", () => {
    expect(releaseSummary(undefined).state).toBe("unknown");
    expect(releaseSummary([run({ status: "in_progress", conclusion: null })]).state).toBe("running");
  });
});
