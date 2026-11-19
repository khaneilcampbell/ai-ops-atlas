import type { Agent, Catalog, Project } from "../catalog/types";
import { OFF_MAP_PROJECTS } from "../catalog/projects";
import { ownership } from "../catalog/ownership";
import { managedAgent } from "../manage/manifest";
import { n8nWorkflowIds } from "../n8n/links";
import type { WorkflowRef } from "./types";

// The Task Center reads agents and buildings from the Atlas catalog (catalog/*.yaml), the same
// registry every other tab uses. Nothing here keeps its own agent list.

export interface AgentProfile {
  id: string;
  name: string;
  buildingId: string;
  buildingName: string;
  /** Declared capabilities plus the registry's listed tasks. Empty when the manifest declares none. */
  capabilities: string[];
  /** Where it runs, as the manifest says. "Not documented" when it doesn't. */
  environment: string;
  status: Agent["status"];
  /** Workflows the agent links to or is allowed to run, read from the catalog. */
  workflows: WorkflowRef[];
  /** Why a new task can't be given to it, or null when it can. */
  unavailable: string | null;
}

const N8N_INSTANCE = "https://khancam15.app.n8n.cloud";

/** The workflows a task for this agent can point at: its linked n8n workflows and its GitHub workflow. */
export function agentWorkflows(a: Agent): WorkflowRef[] {
  const out: WorkflowRef[] = [];
  for (const id of n8nWorkflowIds(a)) {
    const link = a.links.find((l) => l.url.includes(`/workflow/${id}`));
    out.push({ kind: "n8n", id, label: link?.label ?? `n8n workflow ${id}`, url: link?.url ?? `${N8N_INSTANCE}/workflow/${id}` });
  }
  const managed = managedAgent(a.id);
  const file = managed?.workflow ?? a.observe?.githubWorkflow;
  if (file) out.push({ kind: "github", id: file, label: `GitHub · ${file}`, repository: a.repository, url: `https://github.com/${a.repository}/actions/workflows/${file}` });
  return out;
}

export function agentProblem(a: Agent | undefined): string | null {
  if (!a) return "That agent isn't in the Atlas catalog any more.";
  if (a.status === "retired") return `${a.name} is retired, so it can't take new tasks.`;
  return null;
}

/** An owning agent's workflows include those of the automations it owns (owned_by), named by automation. */
export function ownedWorkflows(owned: readonly Agent[]): WorkflowRef[] {
  return owned.flatMap((o) => agentWorkflows(o).map((w) => ({ ...w, label: `${o.name} · ${w.label}` })));
}

export function agentProfile(a: Agent, projects: readonly Project[], owned: readonly Agent[] = []): AgentProfile {
  const p = projects.find((x) => x.id === a.projectId);
  const caps = [...new Set([...(a.capabilities ?? []), ...(a.registry?.responsibilities?.tasks ?? [])])];
  return {
    id: a.id,
    name: a.name,
    buildingId: a.projectId,
    buildingName: p?.name ?? a.projectId,
    capabilities: caps,
    environment: a.registry?.execution?.environment ?? a.runtime ?? "Not documented",
    status: a.status,
    workflows: [...agentWorkflows(a), ...ownedWorkflows(owned)].filter((w, i, all) => all.findIndex((x) => x.kind === w.kind && x.id === w.id) === i),
    unavailable: agentProblem(a),
  };
}

/** Every catalog agent as a profile, sorted by name. Retired agents stay listed (for history) but marked. */
export function agentProfiles(c: Catalog): AgentProfile[] {
  const { owned } = ownership(c);
  return c.agents.map((a) => agentProfile(a, c.projects, owned.get(a.id))).sort((x, y) => x.name.localeCompare(y.name));
}

/** Buildings a task can be filed under: the ones on the map. */
export function taskBuildings(c: Catalog): Pick<Project, "id" | "name">[] {
  return c.projects.filter((p) => !OFF_MAP_PROJECTS.has(p.id)).map((p) => ({ id: p.id, name: p.name })).sort((a, b) => a.name.localeCompare(b.name));
}
