import type { Agent, Project } from "../catalog/types";
import { servicesOf } from "../catalog/roles";
import { pipelineStage, type StageState } from "../commerce/pipeline";
import type { RegistryEntry } from "../registry/registry";

// The outside vendors and suppliers this workspace depends on, for the Vendor & Supplier Hub
// (Integration Exchange module, capability "catalog"). A vendor is listed only when an agent or
// automation's manifest names it among its tools (src/catalog/roles.ts SERVICES), so the list comes
// from the repositories, not from a guess. Health is the worst observed state of the workers that
// use it, read the same way as the publishing pipeline (src/commerce/pipeline.ts pipelineStage):
// a worker with no run seen is unknown, never healthy.

export interface SupplierRow {
  /** Service id from roles.ts, e.g. "stripe". */
  id: string;
  vendor: string;
  /** What it does for the workspace, e.g. "Payments Office". */
  role: string;
  projects: string[];
  workers: number;
  state: StageState;
  /** Newest run Atlas observed among its workers. */
  lastRunAt: string | null;
  lastRunUrl: string | null;
}

const ORDER: Record<StageState, number> = { failing: 0, silent: 1, unknown: 2, ok: 3, "not-running": 4 };

/** Worst state first, so one failing worker marks its vendor as failing. Workers switched off on purpose don't count unless all are. */
export function worstState(states: readonly StageState[]): StageState {
  const active = states.filter((s) => s !== "not-running");
  if (!active.length) return states.length ? "not-running" : "unknown";
  return active.reduce((a, b) => (ORDER[b] < ORDER[a] ? b : a));
}

export function supplierRows(projects: readonly Project[], agents: readonly Agent[], entries: readonly RegistryEntry[], now: number, feedLive: boolean): SupplierRow[] {
  const live = new Set(projects.filter((p) => p.status !== "retired").map((p) => p.id));
  const workers = agents.filter((a) => a.status !== "retired" && live.has(a.projectId));
  const byId = new Map(entries.map((e) => [e.profile.id, e]));
  const names = new Map(projects.map((p) => [p.id, p.name]));
  return servicesOf(workers)
    .map((s) => {
      const stages = s.users.map((a) => pipelineStage(a, byId.get(a.id), now, feedLive));
      const newest = stages.filter((st) => st.last?.at).sort((a, b) => Date.parse(b.last!.at) - Date.parse(a.last!.at))[0];
      return {
        id: s.id,
        vendor: s.vendor,
        role: s.name,
        projects: [...new Set(s.users.map((a) => names.get(a.projectId) ?? a.projectId))],
        workers: s.users.length,
        state: worstState(stages.map((st) => st.state)),
        lastRunAt: newest?.last?.at ?? null,
        lastRunUrl: newest?.last?.url ?? null,
      };
    })
    .sort((a, b) => ORDER[a.state] - ORDER[b.state] || a.vendor.localeCompare(b.vendor));
}

export type SourceState = "connected" | "not-connected";

/** Where vendor data could come from, and whether Atlas reads it today. Reasons are shown as written. */
export const SUPPLIER_SOURCES: readonly { id: string; label: string; state: SourceState; detail: string }[] = [
  { id: "manifests", label: "Repository manifests", state: "connected", detail: "Each agent's declared tools name the vendors it uses" },
  { id: "runs", label: "Worker runs", state: "connected", detail: "GitHub Actions and agent reports give health and last run per vendor" },
  { id: "billing", label: "Vendor bills and invoices", state: "not-connected", detail: "No billing export or read-only billing key is set up; spend caps are in the Financial Operations Tower" },
  { id: "contracts", label: "Contracts and renewals", state: "not-connected", detail: "No contract store or email inbox is connected" },
];
