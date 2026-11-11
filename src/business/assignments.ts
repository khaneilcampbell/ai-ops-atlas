import { isAiAgent } from "../catalog/roles";
import type { Agent, Catalog } from "../catalog/types";
import type { RepoState } from "../github/types";
import { observedRun, repoData } from "../lib/derive";
import { instancesOf, workspaceBuildings } from "../modules/instances";
import { buildingAssets } from "../modules/operations";
import { n8nHealth, n8nWorkflowId } from "../n8n/runs";
import type { N8nSnapshot } from "../n8n/types";

// Business Operations HQ: which agents and automations work for each business the workspace runs,
// what starts them, where they run, and how their last run went. Built only from the catalog
// manifests plus the runs Atlas already reads (live n8n and GitHub Actions). An item with no
// observable runs says so; it is never shown as healthy.

export type AssignmentState = "ok" | "failing" | "running" | "off" | "not-seen" | "not-observed";

export interface Assignment {
  id: string;
  name: string;
  kind: "agent" | "automation";
  trigger: string | null;
  runtime: string | null;
  state: AssignmentState;
  /** Where the last run came from, when one was seen. */
  source: "n8n" | "github" | null;
  lastAt: string | null;
  url: string | null;
}

export interface BusinessAssignments {
  projectId: string;
  business: string;
  items: Assignment[];
}

function assignment(a: Agent, n8n: N8nSnapshot | null, repos: Record<string, RepoState>): Assignment {
  const base = { id: a.id, name: a.name, kind: isAiAgent(a) ? "agent" : "automation", trigger: a.trigger ?? null, runtime: a.runtime ?? a.framework ?? null } as const;
  const wfId = n8nWorkflowId(a);
  if (wfId && n8n?.state === "ok") {
    const wf = n8n.workflows.find((w) => w.id === wfId);
    if (wf) {
      const h = n8nHealth(wf);
      const last = wf.runs[0];
      const state: AssignmentState = h === "ok" ? "ok" : h === "failing" ? "failing" : h === "off" ? "off" : last?.status === "running" ? "running" : "not-seen";
      return { ...base, state, source: last ? "n8n" : null, lastAt: last?.startedAt ?? null, url: null };
    }
  }
  const run = observedRun(a, repoData(repos[a.repository]));
  if (run) {
    const state: AssignmentState = run.status !== "completed" ? "running" : run.conclusion === "success" ? "ok" : run.conclusion === "failure" || run.conclusion === "timed_out" ? "failing" : "not-seen";
    return { ...base, state, source: "github", lastAt: run.createdAt, url: run.url };
  }
  // Declares a run source Atlas reads (GitHub, n8n or the agent feed), but no run was seen here: not
  // seen. Otherwise it reports nowhere Atlas reads: not observed.
  const watched = !!a.observe?.githubWorkflow || !!a.observe?.agentFeed || !!wfId;
  return { ...base, state: watched ? "not-seen" : "not-observed", source: null, lastAt: null, url: null };
}

const ORDER: Record<AssignmentState, number> = { failing: 0, running: 1, ok: 2, "not-seen": 3, off: 4, "not-observed": 5 };

/**
 * One group per business the Business Operations HQ module houses (in catalog order), listing the
 * agents and automations assigned to it. Failing first, then by most recent run, then by name.
 */
export function automationAssignments(catalog: Catalog, n8n: N8nSnapshot | null, repos: Record<string, RepoState>): BusinessAssignments[] {
  return instancesOf(workspaceBuildings(catalog), "business-operations-hq").flatMap((b) => {
    if (!b.projectId) return [];
    const assets = buildingAssets(b, catalog);
    const items = [...assets.agents, ...assets.automations]
      .filter((a) => a.status !== "retired")
      .map((a) => assignment(a, n8n, repos))
      .sort((x, y) => ORDER[x.state] - ORDER[y.state] || (y.lastAt ?? "").localeCompare(x.lastAt ?? "") || x.name.localeCompare(y.name));
    return [{ projectId: b.projectId, business: b.organization ?? b.name, items }];
  });
}

export function assignmentCounts(groups: readonly BusinessAssignments[]) {
  const all = groups.flatMap((g) => g.items);
  return {
    total: all.length,
    failing: all.filter((i) => i.state === "failing").length,
    observed: all.filter((i) => i.source !== null).length,
  };
}
