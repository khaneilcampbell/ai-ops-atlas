import { PRODUCT_LAB_AGENT } from "../reports/productLab";
import type { StoredTask } from "../tasks/types";
import type { WorkflowRun } from "../workflows/types";
import { netCents } from "./revenue";
import { PRODUCT_STAGES, type BusinessData } from "./types";

// Agent business impact: what each agent did and what business results are tied to it, kept in
// three separate buckets so nothing is over-claimed:
//   direct    a sale whose attribution says the agent's own output closed it, with evidence
//   assisted  a sale or won lead the agent worked (attribution "assisted", or the lead's agent)
//   estimated never filled in: Atlas has no attribution model, so it says so instead of guessing.
// Reliability, cost and manual review come from Task Center tasks the agent was assigned.

export interface AgentImpact {
  agentId: string;
  agentName: string;
  tasksCompleted: number;
  tasksFailed: number;
  /** Completed / (completed + failed); null with neither. */
  reliability: number | null;
  /** Share of the agent's tasks that needed a person's approval; null with no tasks. */
  manualReviewRate: number | null;
  aiCostUsd: number;
  aiCostEstimated: boolean;
  workflowRuns: number;
  direct: { sales: number; byCurrency: Record<string, number> };
  assisted: { sales: number; wonLeads: number; byCurrency: Record<string, number> };
  /** Product Lab only: research picks that a person later approved for build or beyond. */
  researchApproved: number | null;
  researchTotal: number | null;
}

const add = (m: Record<string, number>, k: string, v: number) => void (m[k] = (m[k] ?? 0) + v);

export function agentImpact(data: BusinessData, tasks: readonly StoredTask[], runs: readonly WorkflowRun[], names: ReadonlyMap<string, string> = new Map()): AgentImpact[] {
  const ids = new Set<string>();
  for (const t of tasks) if (t.agentId) ids.add(t.agentId);
  for (const s of data.sales) if (s.provenance === "real" && s.attribution) ids.add(s.attribution.agentId);
  for (const l of data.leads) if (l.provenance === "real" && l.agentId) ids.add(l.agentId);
  if (data.products.some((p) => p.provenance === "real" && p.researchReportId !== undefined)) ids.add(PRODUCT_LAB_AGENT);

  const taskAgent = new Map(tasks.map((t) => [t.id, t.agentId]));
  return [...ids]
    .map((agentId): AgentImpact => {
      const mine = tasks.filter((t) => t.agentId === agentId);
      const done = mine.filter((t) => t.status === "completed").length;
      const failed = mine.filter((t) => t.status === "failed").length;
      let usd = 0, est = false;
      for (const t of mine) for (const u of t.usage) if (u.cost) { usd += u.cost.usd; est ||= u.cost.basis === "estimated"; }
      const direct = { sales: 0, byCurrency: {} as Record<string, number> };
      const assisted = { sales: 0, wonLeads: 0, byCurrency: {} as Record<string, number> };
      for (const s of data.sales) {
        if (s.provenance !== "real" || s.attribution?.agentId !== agentId || !s.attribution.evidence.trim()) continue;
        const b = s.attribution.kind === "direct" ? direct : assisted;
        b.sales += 1;
        add(b.byCurrency, s.currency, netCents(s));
      }
      assisted.wonLeads = data.leads.filter((l) => l.provenance === "real" && l.agentId === agentId && l.stage === "won").length;
      const research = agentId === PRODUCT_LAB_AGENT ? data.products.filter((p) => p.provenance === "real" && p.researchReportId !== undefined) : null;
      return {
        agentId,
        agentName: names.get(agentId) ?? mine.find((t) => t.agentName)?.agentName ?? agentId,
        tasksCompleted: done,
        tasksFailed: failed,
        reliability: done + failed ? done / (done + failed) : null,
        manualReviewRate: mine.length ? mine.filter((t) => t.requiresApproval || t.categories.length > 0).length / mine.length : null,
        aiCostUsd: Math.round(usd * 10_000) / 10_000,
        aiCostEstimated: est,
        workflowRuns: runs.filter((r) => Object.values(r.nodeTasks).some((id) => taskAgent.get(id) === agentId)).length,
        direct,
        assisted,
        researchApproved: research ? research.filter((p) => PRODUCT_STAGES.indexOf(p.stage) >= PRODUCT_STAGES.indexOf("build")).length : null,
        researchTotal: research ? research.length : null,
      };
    })
    .sort((a, b) => b.tasksCompleted - a.tasksCompleted || a.agentName.localeCompare(b.agentName));
}
