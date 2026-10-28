import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildCatalog } from "../../catalog/parse";
import type { AuditRecord, ActionsStatus } from "../../actions/types";
import type { ExecutionRecord, Telemetry } from "../../registry/types";
import { actionExecutions, planOffice, runtimeFor } from "./model";

const dir = join(__dirname, "../../../catalog");
const { catalog } = buildCatalog(Object.fromEntries(readdirSync(dir).filter((f) => f.endsWith(".yaml")).map((f) => [f, readFileSync(join(dir, f), "utf8")])));

const tel = (over: Partial<Telemetry> = {}): Telemetry => ({
  source: "github",
  loaded: true,
  executions: [],
  lastVerifiedRun: null,
  lastAnyRun: null,
  successRate: null,
  failures: 0,
  avgDurationMs: null,
  monthSpendUsd: null,
  monthBudgetUsd: null,
  ...over,
});
const run = (at: string, result: ExecutionRecord["result"]): ExecutionRecord => ({ at, result, label: "CI", source: "github" });
const agent = { id: "atlas-ci", status: "active" as const };

describe("office plan", () => {
  it("gives the AI Ops Atlas headquarters one desk per registered agent, in manifest order", () => {
    const project = catalog.projects.find((p) => p.id === "ai-ops-atlas")!;
    const agents = catalog.agents.filter((a) => a.projectId === project.id);
    expect(agents.map((a) => a.id)).toEqual(["atlas-ci", "repo-intelligence", "atlas-rerun-failed"]);
    const plan = planOffice(project, agents);
    expect(plan.buildingId).toBe("repo:khaneilcampbell/ai-ops-atlas");
    expect(plan.workstations.map((w) => w.id)).toEqual(["ai-ops-atlas/atlas-ci", "ai-ops-atlas/repo-intelligence", "ai-ops-atlas/atlas-rerun-failed"]);
    expect(new Set(plan.workstations.map((w) => `${w.x},${w.z}`)).size).toBe(3);
    // Stable: the same input always gives the same desks.
    expect(planOffice(project, agents)).toEqual(plan);
  });

  it("has no desks for a project without agents", () => {
    expect(planOffice({ id: "x", repository: "me/x" }, []).workstations).toEqual([]);
  });
});

describe("runtime state", () => {
  it("never shows working without an observed run in progress", () => {
    expect(runtimeFor(agent, tel()).state).toBe("idle");
    expect(runtimeFor(agent, tel({ source: null, loaded: false })).state).toBe("unknown");
    expect(runtimeFor(agent, tel({ loaded: false })).state).toBe("unknown");
    expect(runtimeFor(agent, tel({ executions: [run("2026-10-28T02:00:00Z", "running")] })).state).toBe("working");
  });

  it("reports the latest completed run's failure, and a later success clears it", () => {
    expect(runtimeFor(agent, tel({ executions: [run("2026-10-28T02:00:00Z", "failure"), run("2026-10-27T02:00:00Z", "success")] })).state).toBe("failed");
    expect(runtimeFor(agent, tel({ executions: [run("2026-10-28T02:00:00Z", "success"), run("2026-10-27T02:00:00Z", "failure")] })).state).toBe("idle");
  });

  it("treats paused and retired agents as offline", () => {
    expect(runtimeFor({ id: "a", status: "paused" }, tel()).state).toBe("offline");
  });

  it("reads the re-run action from the audit log and its switch", () => {
    const a = { id: "atlas-rerun-failed", status: "idle" as const };
    const none = tel({ source: null, loaded: false });
    const status = (enabled: boolean): ActionsStatus => ({ config: { rerun_failed_jobs: { enabled, repos: [] }, token_login: null }, token: true });
    expect(runtimeFor(a, none, { available: false, status: null, audit: [] }).state).toBe("unknown");
    expect(runtimeFor(a, none, { available: true, status: status(false), audit: [] }).state).toBe("offline");
    expect(runtimeFor(a, none, { available: true, status: status(true), audit: [] }).state).toBe("idle");
    const rec = (id: string, at: string, stage: AuditRecord["stage"]): AuditRecord => ({
      id, at, stage, action: "rerun_failed_jobs", actor: "KC", github_login: null, repo: "me/r", run_id: 1, workflow: "CI", run_number: 3,
      attempt_before: 1, head_sha: null, branch: "main", reason: null, http_status: null, request_id: null, message: null,
    });
    const audit = [rec("x", "2026-10-28T01:00:00Z", "attempted"), rec("x", "2026-10-28T01:00:01Z", "failed")];
    expect(actionExecutions("rerun_failed_jobs", audit)).toHaveLength(1);
    expect(runtimeFor(a, none, { available: true, status: status(true), audit }).state).toBe("failed");
  });
});
