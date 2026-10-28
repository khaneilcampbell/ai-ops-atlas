import type { Agent, Catalog, ConnectionType, Project } from "../catalog/types";
import type { RepoSnapshot, RepoState, WorkflowRun } from "../github/types";
import { PRIVATE_OR_MISSING } from "../github/transport";
import { observedRun, repoData } from "./derive";
import { daysSince } from "./time";

/** One end of a connection: a project (its headquarters on the map) or an agent (its house). */
export interface Endpoint {
  kind: "project" | "agent";
  id: string;
}

/**
 * active: activity verified within the last 14 days. inactive: verified, but older or cached.
 * unhealthy: live data shows a failure. unknown: nothing live to check against.
 */
export type ConnectionStatus = "active" | "inactive" | "unhealthy" | "unknown";

export interface Connection {
  id: string;
  source: Endpoint;
  target: Endpoint;
  type: ConnectionType;
  /** True when the evidence says which way it runs, from source to target. */
  directed: boolean;
  /** Reads between the two names: "Contact Form Worker depends on Benjaire Flow Intake". */
  relation: string;
  /** Where the relationship is stated: manifest fields, never inference. */
  evidence: string[];
  status: ConnectionStatus;
  statusNote: string;
  /** Last activity verified from live data, if any. */
  lastVerified: string | null;
  repositories: string[];
  agents: string[];
  workflows: string[];
  details: string[];
}

/** The project that is this app; it reads every other repository in the catalog. */
export const ATLAS_PROJECT = "ai-ops-atlas";
const RECENT_DAYS = 14;
const isN8n = (a: Agent) => /n8n/i.test(`${a.framework} ${a.runtime ?? ""}`);
const failed = (r?: WorkflowRun) => r?.conclusion === "failure" || r?.conclusion === "timed_out";

/**
 * The latest observed run on the default branch, which decides health; a failed run on a pull
 * request branch says nothing about the link. Falls back to any branch when the default is unknown.
 */
function mainRun(agent: Agent, snap: RepoSnapshot | undefined): WorkflowRun | undefined {
  const runs = (agent.observe?.githubWorkflow && snap?.workflowRuns[agent.observe.githubWorkflow]) || [];
  return snap?.defaultBranch ? runs.find((r) => r.branch === snap.defaultBranch) : runs[0];
}

const uniq = (xs: (string | undefined)[]) => [...new Set(xs.filter((x): x is string => !!x))];

/**
 * Every relationship the catalog states, with status from cached GitHub data. Sources, and
 * nothing else: an agent's `source` or observed workflow (the repository hosts it), registry
 * `dependencies` between agents, a project's declared `connections`, and Atlas reading each
 * cataloged repository. Shared technology is never treated as a connection.
 */
export function buildConnections(catalog: Catalog, repos: Record<string, RepoState>, now = Date.now()): Connection[] {
  const agents = new Map(catalog.agents.map((a) => [a.id, a]));
  const projects = new Map(catalog.projects.map((p) => [p.id, p]));
  const byRepo = new Map(catalog.projects.map((p) => [p.repository, p]));
  const fileOf = (projectId: string) => `catalog/${projects.get(projectId)?.file ?? `${projectId}.yaml`}`;
  const nameOf = (e: Endpoint) => (e.kind === "agent" ? agents.get(e.id)?.name : projects.get(e.id)?.name) ?? e.id;
  const out: Connection[] = [];

  // The repository that holds an agent's code or workflow.
  for (const a of catalog.agents) {
    const wf = a.observe?.githubWorkflow;
    const home = byRepo.get(a.repository);
    if (!home || (!a.source && !wf)) continue;
    const state = repos[a.repository];
    const snap = repoData(state);
    const run = mainRun(a, snap);
    let status: ConnectionStatus = "unknown";
    let note = wf ? (state?.kind === "loading" ? "Syncing with GitHub" : "GitHub data not loaded") : "No live source for this agent";
    if (run) {
      const days = daysSince(run.createdAt, now) ?? Infinity;
      status = failed(run) ? "unhealthy" : days <= RECENT_DAYS ? "active" : "inactive";
      note = `Latest ${wf} run on ${run.branch}: ${run.conclusion ?? run.status}`;
    } else if (wf && snap) note = `No ${wf} runs on ${snap.defaultBranch} yet`;
    out.push({
      id: `repo:${a.id}`,
      source: { kind: "project", id: home.id },
      target: { kind: "agent", id: a.id },
      type: "github",
      directed: true,
      relation: "hosts",
      evidence: [a.source && `${fileOf(a.projectId)}: ${a.id} source is ${a.source}`, wf && `${fileOf(a.projectId)}: ${a.id} observes the ${wf} workflow`].filter((x): x is string => !!x),
      status,
      statusNote: note,
      lastVerified: observedRun(a, snap)?.createdAt ?? null,
      repositories: [a.repository],
      agents: [a.name],
      workflows: uniq([wf && `GitHub Actions: ${wf}`, isN8n(a) ? `n8n: ${a.name}` : undefined]),
      details: uniq([a.source && `Source: ${a.source}`, a.trigger && `Trigger: ${a.trigger}`]),
    });
  }

  // Agent dependencies from the registry; a pair that lists each other becomes one two-way link.
  const pairs = new Map<string, { a: Agent; b: Agent; mutual: boolean }>();
  for (const a of catalog.agents)
    for (const dep of a.registry?.responsibilities?.dependencies ?? []) {
      const b = agents.get(dep);
      if (!b || b.id === a.id) continue;
      const key = [a.id, b.id].sort().join("~");
      const seen = pairs.get(key);
      if (seen) seen.mutual = seen.mutual || seen.a.id !== a.id;
      else pairs.set(key, { a, b, mutual: false });
    }
  for (const [key, { a, b, mutual }] of pairs) {
    const latest = [a, b].map((x) => observedRun(x, repoData(repos[x.repository]))?.createdAt).filter((t) => !!t).sort().pop() ?? null;
    const broken = [a, b].map((x) => mainRun(x, repoData(repos[x.repository]))).find(failed);
    const n8n = [a, b].filter(isN8n);
    const evidence = [`${fileOf(a.projectId)}: ${a.id} lists ${b.id} under dependencies`];
    if (mutual) evidence.push(`${fileOf(b.projectId)}: ${b.id} lists ${a.id} under dependencies`);
    out.push({
      id: `dep:${key}`,
      source: { kind: "agent", id: a.id },
      target: { kind: "agent", id: b.id },
      type: n8n.length ? "n8n" : a.projectId !== b.projectId ? "dependency" : "agent",
      directed: !mutual,
      relation: mutual ? "works with" : "depends on",
      evidence,
      // A failing side is real evidence of trouble; anything else about the link itself is not observed.
      status: broken ? "unhealthy" : "unknown",
      statusNote: broken ? `Latest ${broken.name} run on ${broken.branch} failed` : "No activity data for this link",
      lastVerified: latest,
      repositories: uniq([a.repository, b.repository]),
      agents: [a.name, b.name],
      workflows: n8n.map((x) => `n8n: ${x.name}`),
      details: uniq([a.trigger && `${a.name} trigger: ${a.trigger}`, b.trigger && `${b.name} trigger: ${b.trigger}`]),
    });
  }

  // Connections a project's manifest declares outright.
  for (const p of catalog.projects)
    for (const c of p.connections ?? []) {
      const kind = projects.has(c.to) ? "project" : agents.has(c.to) ? "agent" : null;
      if (!kind) continue;
      const self: Endpoint = { kind: "project", id: p.id };
      const other: Endpoint = { kind, id: c.to };
      const [source, target] = c.direction === "inbound" ? [other, self] : [self, other];
      const otherAgent = agents.get(c.to);
      out.push({
        id: `decl:${p.id}:${c.to}`,
        source,
        target,
        type: c.type,
        directed: !!c.direction,
        relation: c.direction ? "connects to" : "is connected with",
        evidence: [`${fileOf(p.id)}: project.connections, ${c.note}`],
        status: "unknown",
        statusNote: "Declared in the manifest; no live data for this link",
        lastVerified: null,
        repositories: uniq([p.repository, otherAgent?.repository ?? projects.get(c.to)?.repository]),
        agents: otherAgent ? [otherAgent.name] : [],
        workflows: otherAgent && isN8n(otherAgent) ? [`n8n: ${otherAgent.name}`] : [],
        details: [c.note],
      });
    }

  // Atlas reads every cataloged repository from GitHub; this is the app's own data flow.
  const atlas = projects.get(ATLAS_PROJECT);
  if (atlas)
    for (const p of catalog.projects) {
      if (p.id === atlas.id) continue;
      const { status, note, at } = syncStatus(repos[p.repository], now);
      out.push({
        id: `sync:${p.id}`,
        source: { kind: "project", id: p.id },
        target: { kind: "project", id: atlas.id },
        type: "github",
        directed: true,
        relation: "is read by",
        evidence: [`${fileOf(p.id)} registers ${p.repository}`, "AI Ops Atlas reads it from the GitHub API, read-only"],
        status,
        statusNote: note,
        lastVerified: at,
        repositories: [p.repository, atlas.repository],
        agents: [],
        workflows: [],
        details: ["Commits, workflow runs and repository metadata"],
      });
    }

  return out.map((c) => ({ ...c, relation: `${nameOf(c.source)} ${c.relation} ${nameOf(c.target)}` }));
}

function syncStatus(state: RepoState | undefined, now: number): { status: ConnectionStatus; note: string; at: string | null } {
  if (!state) return { status: "unknown", note: "Not synced yet", at: null };
  if (state.kind === "loading") return { status: "unknown", note: "Syncing with GitHub", at: null };
  if (state.kind === "error") {
    const at = state.data?.fetchedAt ?? null;
    // A failed read means Atlas could not check, not that the repository is broken.
    if (state.message === PRIVATE_OR_MISSING) return { status: "unknown", note: "Private or not found without a GitHub token", at };
    return { status: "unknown", note: `Latest sync failed: ${state.message}`, at };
  }
  const days = daysSince(state.data.fetchedAt, now) ?? Infinity;
  if (state.stale || days > 1) return { status: "inactive", note: "Showing cached GitHub data", at: state.data.fetchedAt };
  return { status: "active", note: "Read from GitHub recently", at: state.data.fetchedAt };
}

/** Projects an endpoint belongs to, for focus highlighting. */
export function projectOfEndpoint(catalog: Catalog, e: Endpoint): Project | undefined {
  const id = e.kind === "project" ? e.id : catalog.agents.find((a) => a.id === e.id)?.projectId;
  return catalog.projects.find((p) => p.id === id);
}

/** Map key of the building that stands for an endpoint. */
export function endpointKey(catalog: Catalog, e: Endpoint): string | undefined {
  if (e.kind === "agent") return `agent:${e.id}`;
  const p = catalog.projects.find((x) => x.id === e.id);
  return p && `repo:${p.repository}`;
}

export const CONNECTION_LABEL: Record<Connection["type"], string> = { github: "GitHub", agent: "AI agents", n8n: "n8n", dependency: "Dependencies" };
export const CONNECTION_STATUS_LABEL: Record<ConnectionStatus, string> = { active: "Active", inactive: "Inactive", unhealthy: "Unhealthy", unknown: "Unknown" };
/** Connection colors, deeper by day to hold up against the bright scene and lighter at night. */
export const LINK_COLORS: Record<ConnectionType | "unhealthy", { day: string; night: string }> = {
  github: { day: "#1f8ec2", night: "#62cbf4" },
  agent: { day: "#7a52cc", night: "#b597ff" },
  n8n: { day: "#dd7428", night: "#ffab62" },
  dependency: { day: "#17968a", night: "#52d8c5" },
  unhealthy: { day: "#b54a40", night: "#e06a5d" },
};
