import type { Agent } from "../catalog/types";
import type { Ownership } from "../catalog/ownership";
import { layout, type Layout } from "../workflows/graph";
import type { WorkflowDefinition, WorkflowNode } from "../workflows/types";
import type { RegistryEntry } from "../registry/registry";
import { isDraft } from "./board";

// The Automations Flows tab: each owning agent's automations as one diagram, joined by the
// handoffs the catalog records (`feeds`). A handoff is drawn only when recorded; nothing is
// inferred from names or triggers. Layout reuses the workflow canvas's layered layout.

export interface Flow {
  /** Owning agent id, or "" for automations with no owner. */
  ownerId: string;
  entries: RegistryEntry[];
  edges: { from: string; to: string; gate: boolean }[];
}

/** The next step waits on Khaneil when its trigger is his form, button or link. */
export const waitsOnKhaneil = (to: Pick<Agent, "trigger"> | undefined) => /khaneil (submits|approves|presses)|status link clicked/i.test(to?.trigger ?? "");

/** One flow per owning agent: its automations plus any automation a recorded handoff joins to them. */
export function buildFlows(entries: readonly RegistryEntry[], agents: readonly Agent[], owns: Ownership): Flow[] {
  const entryById = new Map(entries.map((e) => [e.profile.id, e]));
  const agentById = new Map(agents.map((a) => [a.id, a]));
  const handoffs = agents.flatMap((a) => (a.feeds ?? []).filter((to) => entryById.has(a.id) && entryById.has(to)).map((to) => ({ from: a.id, to, gate: waitsOnKhaneil(agentById.get(to)) })));
  const groups: [string, string[]][] = [...owns.owned].map(([ownerId, autos]) => [ownerId, autos.map((a) => a.id)]);
  if (owns.orphans.length) groups.push(["", owns.orphans.map((a) => a.id)]);
  return groups
    .map(([ownerId, ids]) => {
      const own = new Set(ids.filter((id) => entryById.has(id)));
      const edges = handoffs.filter((h) => own.has(h.from) || own.has(h.to));
      const all = [...own, ...edges.flatMap((h) => [h.from, h.to]).filter((id) => !own.has(id))];
      return { ownerId, entries: [...new Set(all)].map((id) => entryById.get(id)!), edges };
    })
    .filter((f) => f.entries.length)
    .sort((a, b) => b.edges.length - a.edges.length || b.entries.length - a.entries.length || a.ownerId.localeCompare(b.ownerId));
}

/** Positions for the flow's diagram, from the workflow canvas's layered layout. */
export function flowLayout(flow: Flow): Layout {
  const nodes: WorkflowNode[] = flow.entries.map((e) => ({
    id: e.profile.id,
    kind: "automation",
    stage: 1,
    title: e.profile.title,
    summary: e.profile.summary,
    inputs: [],
    outputs: [],
    execution: { kind: "none", note: e.profile.execution.environment ?? "" },
  }));
  const def: WorkflowDefinition = { id: flow.ownerId || "unowned", version: 1, name: flow.ownerId, updatedAt: "", nodes, edges: flow.edges.map((h) => ({ id: `${h.from}>${h.to}`, from: h.from, to: h.to })) };
  return layout(def);
}

export type Stage = "draft" | "live" | "verified" | "retired";
export const STAGES: { id: Stage; label: string; sub: string }[] = [
  { id: "draft", label: "Draft in n8n", sub: "Paused until published" },
  { id: "live", label: "Live or manual, not verified", sub: "Not a draft, no successful run seen yet" },
  { id: "verified", label: "Verified running", sub: "Run seen in live data" },
  { id: "retired", label: "Retired", sub: "Kept for history" },
];

/** Where an automation sits from draft to retired. Retired ones come from the catalog, not the registry list. */
export function stageOf(e: RegistryEntry): Stage {
  if (e.status === "retired") return "retired";
  if (isDraft(e)) return "draft";
  return e.operational === "verified" ? "verified" : "live";
}
