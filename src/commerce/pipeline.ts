import { watchOf } from "../alerts/alerts";
import type { Agent, Project } from "../catalog/types";
import type { RegistryEntry } from "../registry/registry";
import { mainline } from "../registry/telemetry";
import type { ExecutionRecord } from "../registry/types";

// The publishing pipeline the Commerce & Product Marketplace module watches: every agent of the
// workspace's commerce projects (catalog `module: commerce-product-marketplace`), with what Atlas
// last observed for each. Agents with an `alerts` block follow the alert rules (src/alerts), so a
// stage switched off on purpose reads "Not running", never failing. The rest show their newest
// mainline run. Nothing is inferred: a stage with no run seen says so.

export const COMMERCE_MODULE = "commerce-product-marketplace" as const;

export type StageState = "failing" | "silent" | "ok" | "not-running" | "unknown";

export interface PipelineStage {
  agent: Pick<Agent, "id" | "name" | "projectId">;
  state: StageState;
  detail: string;
  last: ExecutionRecord | null;
}

export const commerceProjects = (projects: readonly Project[]): Project[] => projects.filter((p) => p.module === COMMERCE_MODULE && p.status !== "retired");

export function pipelineStage(agent: Agent, entry: RegistryEntry | undefined, now: number, feedLive: boolean): PipelineStage {
  const base = { agent: { id: agent.id, name: agent.name, projectId: agent.projectId } };
  if (!entry) return { ...base, state: "unknown", detail: "Not in the registry yet", last: null };
  if (agent.alerts) {
    const w = watchOf(agent, entry, now, feedLive);
    const state: StageState = w.state === "no-source" || w.state === "no-reports" ? "unknown" : w.state;
    return { ...base, state, detail: w.detail, last: w.last };
  }
  const runs = mainline(entry.telemetry.executions);
  const done = runs.find((e) => e.result === "success" || e.result === "failure") ?? null;
  if (!done) return { ...base, state: "unknown", detail: entry.telemetry.source ? "No finished run seen yet" : "No live source declared", last: runs[0] ?? null };
  return { ...base, state: done.result === "failure" ? "failing" : "ok", detail: done.label, last: done };
}

const ORDER: Record<StageState, number> = { failing: 0, silent: 1, unknown: 2, ok: 3, "not-running": 4 };

/** Every stage of the commerce projects, problems first. */
export function pipelineStages(projects: readonly Project[], agents: readonly Agent[], entries: readonly RegistryEntry[], now: number, feedLive: boolean): PipelineStage[] {
  const ids = new Set(commerceProjects(projects).map((p) => p.id));
  const byId = new Map(entries.map((e) => [e.profile.id, e]));
  return agents
    .filter((a) => ids.has(a.projectId))
    .map((a) => pipelineStage(a, byId.get(a.id), now, feedLive))
    .sort((a, b) => ORDER[a.state] - ORDER[b.state] || a.agent.name.localeCompare(b.agent.name));
}

export function pipelineCounts(stages: readonly PipelineStage[]): Record<StageState, number> {
  const n: Record<StageState, number> = { failing: 0, silent: 0, ok: 0, "not-running": 0, unknown: 0 };
  for (const s of stages) n[s.state] += 1;
  return n;
}
