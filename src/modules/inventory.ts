import { isAiAgent } from "../catalog/roles";
import type { Catalog } from "../catalog/types";
import type { RepoState } from "../github/types";
import type { Connection } from "../lib/connections";
import type { LiveStatus } from "../live/feed";
import { MODULE_TYPE_LIST, moduleAvailability } from "./catalog";
import type { BuildingInstance, ModuleAvailability, ModuleTypeId } from "./types";
import type { LandmarkInstance } from "./workspace";

// Workspace-wide lists behind four module capabilities. Each one reads only what Atlas already
// holds (the catalog manifests, GitHub snapshots, the live feed and declared connections), so a
// row is either backed by a manifest line or an observed sync, never filled in.

export interface InventoryRow {
  type: ModuleTypeId;
  name: string;
  availability: ModuleAvailability;
  available: number;
  total: number;
  buildings: string[];
}

/** Command Center: every module type, how much of it is built, and which buildings house it. */
export function moduleInventory(buildings: (BuildingInstance | LandmarkInstance)[]): InventoryRow[] {
  return MODULE_TYPE_LIST.map((t) => ({
    type: t.id,
    name: t.name,
    availability: moduleAvailability(t),
    available: t.capabilities.filter((c) => c.state === "available").length,
    total: t.capabilities.length,
    buildings: buildings.filter((b) => b.moduleType === t.id).map((b) => b.name).sort(),
  }));
}

export interface DependencyLink {
  id: string;
  relation: string;
  evidence: string;
  /** Where the link fails today, from an observed run; otherwise the link itself is unverified. */
  failing: boolean;
}

/** Links a manifest states (registry dependencies, project connections), not inferred ones. */
const declared = (c: Connection) => c.id.startsWith("dep:") || c.id.startsWith("decl:");
const link = (c: Connection): DependencyLink => ({ id: c.id, relation: c.relation, evidence: c.evidence[0] ?? "", failing: c.status === "unhealthy" });

export interface ProjectDependencies {
  projectId: string;
  name: string;
  links: DependencyLink[];
}

/** Repository Hub: the dependencies each project's manifests declare, grouped by project. */
export function projectDependencies(connections: Connection[], catalog: Catalog): ProjectDependencies[] {
  const projectOf = (e: Connection["source"]) => (e.kind === "project" ? e.id : catalog.agents.find((a) => a.id === e.id)?.projectId);
  const groups = new Map<string, DependencyLink[]>();
  for (const c of connections.filter(declared))
    for (const p of new Set([projectOf(c.source), projectOf(c.target)]))
      if (p) groups.set(p, [...(groups.get(p) ?? []), link(c)]);
  return catalog.projects
    .filter((p) => groups.has(p.id))
    .map((p) => ({ projectId: p.id, name: p.name, links: groups.get(p.id)! }))
    .sort((a, b) => b.links.length - a.links.length || a.name.localeCompare(b.name));
}

/** Automation Plant: declared links that touch an automation (not an AI agent). */
export function workflowMap(connections: Connection[], catalog: Catalog): DependencyLink[] {
  const automation = new Set(catalog.agents.filter((a) => a.status !== "retired" && !isAiAgent(a)).map((a) => a.id));
  const touches = (e: Connection["source"]) => e.kind === "agent" && automation.has(e.id);
  return connections.filter((c) => declared(c) && (touches(c.source) || touches(c.target))).map(link).sort((a, b) => a.relation.localeCompare(b.relation));
}

export interface Dataset {
  id: string;
  name: string;
  source: string;
  records: string;
  /** ok: current; partial: some of it failed to load; none: nothing held yet. */
  state: "ok" | "partial" | "none";
  updated: string | null;
}

/** Data Intelligence: the datasets Atlas holds right now, how big and how fresh. */
export function datasetInventory(catalog: Catalog, repos: Record<string, RepoState>, live: LiveStatus): Dataset[] {
  const states = Object.values(repos);
  const snaps = states.flatMap((s) => (s.kind === "ok" ? [s.data] : s.kind === "error" && s.data ? [s.data] : []));
  const failed = states.filter((s) => s.kind === "error").length;
  const newest = (xs: (string | null | undefined)[]) => xs.filter((x): x is string => !!x).sort().pop() ?? null;
  const ai = catalog.agents.filter(isAiAgent).length;
  const feedOn = live.state === "live";
  return [
    {
      id: "catalog", name: "Catalog manifests", source: "catalog/*.yaml in the Atlas repository",
      records: `${catalog.projects.length} projects · ${ai} agents · ${catalog.agents.length - ai} automations`,
      state: catalog.projects.length ? "ok" : "none", updated: null,
    },
    {
      id: "github", name: "Repository snapshots", source: "GitHub, read only",
      records: `${snaps.length} of ${states.length} repositories`,
      state: !snaps.length ? "none" : failed ? "partial" : "ok", updated: newest(snaps.map((s) => s.fetchedAt)),
    },
    {
      id: "agent-runs", name: "Agent run reports", source: "Agent reports feed",
      records: live.agentRuns ? `${live.agentRuns.length} kept on this device` : "Not loaded",
      state: live.agentRuns?.length ? "ok" : "none", updated: newest(live.agentRuns?.map((r) => r.at) ?? []),
    },
    {
      id: "intel-runs", name: "Repository Intelligence runs", source: "Atlas Intel via the live feed",
      records: live.intelRuns ? `${live.intelRuns.length} runs` : "Not loaded",
      state: live.intelRuns?.length ? "ok" : "none", updated: null,
    },
    {
      id: "live", name: "Live events", source: "GitHub webhooks via the Atlas site",
      records: feedOn ? "Connected" : live.state === "off" ? "Not set up here" : live.message ?? "Not connected",
      state: feedOn ? "ok" : "none", updated: live.last?.at ?? live.checkedAt,
    },
  ];
}
