import { describe, expect, it } from "vitest";
import { catalog } from "../catalog";
import type { RepoSnapshot, RepoState, WorkflowRun } from "../github/types";
import type { N8nSnapshot, N8nWorkflowRuns } from "../n8n/types";
import { assignmentCounts, automationAssignments } from "./assignments";

const INTAKE = "iQdSJGMQi6TBHlar";
const n8n = (w: Partial<N8nWorkflowRuns>): N8nSnapshot => ({
  state: "ok", instance: "https://x.app.n8n.cloud", fetchedAt: "2026-11-11T12:00:00Z", window: 250,
  workflows: [{ id: INTAKE, name: "Flow 1 Intake", active: true, runs: [], failures24h: 0, ...w }],
});
const ciRun = (conclusion: string | null, status = "completed"): WorkflowRun =>
  ({ name: "Site CI", status, conclusion, branch: "main", event: "push", createdAt: "2026-11-11T09:00:00Z", url: "https://github.com/x/run/1" });
const repos = (runs: WorkflowRun[]): Record<string, RepoState> => {
  const repo = catalog.projects.find((p) => p.id === "benjaire-site")!.repository;
  const data = { fullName: repo, defaultBranch: "main", runs, workflowRuns: { "site-ci.yml": runs } } as unknown as RepoSnapshot;
  return { [repo]: { kind: "ok", data, stale: false } };
};
const item = (groups: ReturnType<typeof automationAssignments>, id: string) => groups.flatMap((g) => g.items).find((i) => i.id === id)!;

describe("automation assignments", () => {
  it("groups the agents and automations of each business the HQ module houses", () => {
    const groups = automationAssignments(catalog, null, {});
    expect(groups.map((g) => g.projectId)).toEqual(["benjaire-site"]);
    expect(groups[0].business).toBe("Benjaire");
    const ids = groups[0].items.map((i) => i.id);
    expect(ids).toEqual(expect.arrayContaining(["benjaire-contact-worker", "benjaire-flow-intake", "benjaire-site-ci", "benjaire-product-lab"]));
    expect(item(groups, "benjaire-flow-intake")).toMatchObject({ kind: "automation", trigger: "Webhook from the contact Worker", runtime: "n8n Cloud" });
  });

  it("never calls an item healthy without an observed run", () => {
    const groups = automationAssignments(catalog, null, {});
    expect(groups[0].items.some((i) => i.state === "ok")).toBe(false);
    expect(item(groups, "benjaire-site-ci").state).toBe("not-seen");
    expect(item(groups, "benjaire-flow-intake").state).toBe("not-seen");
    expect(item(groups, "benjaire-inquiry-to-client").state).toBe("not-observed");
    expect(assignmentCounts(groups).observed).toBe(0);
  });

  it("reads the last run from live n8n for a linked workflow", () => {
    const ok = automationAssignments(catalog, n8n({ runs: [{ id: "1", status: "success", mode: "webhook", startedAt: "2026-11-11T08:00:00Z", stoppedAt: null }] }), {});
    expect(item(ok, "benjaire-flow-intake")).toMatchObject({ state: "ok", source: "n8n", lastAt: "2026-11-11T08:00:00Z" });
    const bad = automationAssignments(catalog, n8n({ runs: [{ id: "2", status: "error", mode: "webhook", startedAt: "2026-11-11T08:00:00Z", stoppedAt: null }] }), {});
    expect(item(bad, "benjaire-flow-intake").state).toBe("failing");
    expect(bad[0].items[0].id).toBe("benjaire-flow-intake");
    expect(assignmentCounts(bad).failing).toBe(1);
    const idle = automationAssignments(catalog, n8n({}), {});
    expect(item(idle, "benjaire-flow-intake")).toMatchObject({ state: "not-seen", source: null });
    const off = automationAssignments(catalog, n8n({ active: false }), {});
    expect(item(off, "benjaire-flow-intake").state).toBe("off");
  });

  it("reads the last run from GitHub Actions for a watched workflow", () => {
    expect(item(automationAssignments(catalog, null, repos([ciRun("success")])), "benjaire-site-ci")).toMatchObject({ state: "ok", source: "github", url: "https://github.com/x/run/1" });
    expect(item(automationAssignments(catalog, null, repos([ciRun("failure")])), "benjaire-site-ci").state).toBe("failing");
    expect(item(automationAssignments(catalog, null, repos([ciRun(null, "in_progress")])), "benjaire-site-ci").state).toBe("running");
  });
});
