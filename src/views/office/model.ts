import type { Agent, Project } from "../../catalog/types";
import type { AuditRecord, ActionsStatus } from "../../actions/types";
import { latestPerAttempt, STAGE_LABEL } from "../../actions/rerun";
import type { ExecutionRecord, Telemetry } from "../../registry/types";

/**
 * The data behind a virtual office: which project and building it belongs to, one workstation
 * per registered agent, and each agent's runtime state as far as verified data can tell.
 * Pure, so it can be tested and later fed by live telemetry, task queues or approvals.
 */

/** What a workstation shows. "unknown" when no live source can say what the agent is doing. */
export type RuntimeState = "working" | "awaiting" | "failed" | "idle" | "offline" | "unknown";

export const RUNTIME_LABEL: Record<RuntimeState, string> = {
  working: "Working",
  awaiting: "Awaiting approval",
  failed: "Latest run failed",
  idle: "Idle",
  offline: "Offline",
  unknown: "Status unavailable",
};

export interface Runtime {
  state: RuntimeState;
  /** Why, in a sentence, naming the source. */
  reason: string;
  /** The execution the state is based on, when there is one. */
  basis: ExecutionRecord | null;
  /** Where the state came from, for the inspector. */
  source: string | null;
}

export interface Workstation {
  /** Stable across reloads: the project and agent ids, never a list position alone. */
  id: string;
  agentId: string;
  /** Desk slot, in manifest order. */
  slot: number;
  x: number;
  z: number;
  /** Rotation about y; desks face the room's open front. */
  ry: number;
}

export interface OfficePlan {
  projectId: string;
  /** The map building this office is inside (the project's headquarters key on the map). */
  buildingId: string;
  /** Floor size; the room grows with the number of desks. */
  w: number;
  d: number;
  workstations: Workstation[];
}

const DESK_DX = 2.35;
const DESK_DZ = 2.5;
const PER_ROW = 3;

/** Desks in rows of three, centered, in manifest order so each agent keeps its desk. */
export function planOffice(project: Pick<Project, "id" | "repository">, agents: Pick<Agent, "id">[]): OfficePlan {
  const n = agents.length;
  const cols = Math.min(PER_ROW, Math.max(1, n));
  const rows = Math.max(1, Math.ceil(n / PER_ROW));
  const w = Math.max(8.5, cols * DESK_DX + 3.6);
  const d = Math.max(7, rows * DESK_DZ + 4.2);
  const workstations = agents.map((a, i) => {
    const row = Math.floor(i / PER_ROW);
    const inRow = Math.min(PER_ROW, n - row * PER_ROW);
    const col = i % PER_ROW;
    return {
      id: `${project.id}/${a.id}`,
      agentId: a.id,
      slot: i,
      x: (col - (inRow - 1) / 2) * DESK_DX,
      z: (row - (rows - 1) / 2) * DESK_DZ + 0.3,
      ry: 0,
    };
  });
  return { projectId: project.id, buildingId: `repo:${project.repository}`, w, d, workstations };
}

/**
 * Agents whose live record is the desktop app's action audit log rather than a workflow or
 * run log. Keyed by agent id, valued by the audit `action` name.
 */
export const ACTION_AGENTS: Record<string, string> = { "atlas-rerun-failed": "rerun_failed_jobs" };

export interface ActionData {
  /** False on the web build and in browsers: the actions live in the desktop app. */
  available: boolean;
  status: ActionsStatus | null;
  audit: AuditRecord[];
}

/** Executions from the action audit log, one per button press, newest first. */
export function actionExecutions(action: string, audit: AuditRecord[]): ExecutionRecord[] {
  return latestPerAttempt(audit.filter((r) => r.action === action)).map((r) => ({
    at: r.at,
    result: r.stage === "started" ? "success" : r.stage === "failed" || r.stage === "unknown" ? "failure" : r.stage === "attempted" ? "running" : "other",
    label: `${STAGE_LABEL[r.stage]} · ${r.workflow ?? "run"} ${r.run_number ? `#${r.run_number}` : ""} on ${r.repo}`.replace(/\s+/g, " "),
    url: `https://github.com/${r.repo}/actions/runs/${r.run_id}`,
    source: "github" as const,
  }));
}

/** The longest a run can really be in progress (GitHub's job limit). */
const MAX_RUN_MS = 6 * 3_600_000;

const when = (at: string) => new Date(at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/**
 * What an agent is doing, from verified data only. Being registered or enabled never counts as
 * working: only an execution observed in progress does. With no live source, or one that has
 * not loaded, the state is "unknown" rather than a guess.
 */
export function runtimeFor(agent: Pick<Agent, "id" | "status">, t: Telemetry, actions?: ActionData, pending = 0, now = Date.now()): Runtime {
  if (agent.status === "retired" || agent.status === "paused") {
    return { state: "offline", reason: `Marked ${agent.status} in its manifest.`, basis: null, source: "Manifest" };
  }
  let executions = t.executions;
  let loaded = t.loaded;
  let source: string | null = t.source === "github" ? "GitHub Actions" : t.source === "atlas-intel" ? "Atlas run log" : null;
  const action = ACTION_AGENTS[agent.id];
  if (action && actions) {
    source = "Atlas action audit log";
    if (!actions.available) return { state: "unknown", reason: "Runs only in the desktop app; its audit log is not visible here.", basis: null, source };
    if (!actions.status) return { state: "unknown", reason: "The action switch and audit log have not loaded.", basis: null, source };
    if (!actions.status.config.rerun_failed_jobs.enabled) return { state: "offline", reason: "Switched off in Settings, so it cannot run.", basis: null, source };
    executions = actionExecutions(action, actions.audit);
    loaded = true;
  }
  if (!source) return { state: "unknown", reason: "No live telemetry source is declared for this agent.", basis: null, source: null };
  if (!loaded) return { state: "unknown", reason: `${source} data has not loaded${t.source === "atlas-intel" ? "; it is only available in the desktop app" : ""}.`, basis: null, source };
  const latest = executions[0];
  // GitHub stops any job after 6 hours, so a run "in progress" older than that is a stale record.
  if (latest?.result === "running" && now - Date.parse(latest.at) < MAX_RUN_MS) return { state: "working", reason: `A run was in progress at the last sync (${when(latest.at)}).`, basis: latest, source };
  // Proposed actions waiting for a person outrank the last result: the agent is blocked on KC.
  if (pending > 0) return { state: "awaiting", reason: `${pending} proposed ${pending === 1 ? "action is" : "actions are"} waiting for your approval.`, basis: latest ?? null, source };
  if (!latest) return { state: "idle", reason: `No runs observed in ${source}.`, basis: null, source };
  const done = executions.find((e) => e.result === "success" || e.result === "failure");
  if (done?.result === "failure") return { state: "failed", reason: `The latest completed run failed (${when(done.at)}).`, basis: done, source };
  return { state: "idle", reason: done ? `Not running. Last run succeeded ${when(done.at)}.` : `Not running. Last activity ${when(latest.at)}.`, basis: done ?? latest, source };
}

/** The technology icon on an agent's monitor and nameplate, from what its manifest declares. */
export type ToolIcon = "github" | "sparkles" | "refresh" | "nodes";
export function toolIcon(agent: Pick<Agent, "id" | "framework" | "model" | "observe">): ToolIcon {
  if (ACTION_AGENTS[agent.id]) return "refresh";
  if (agent.observe?.githubWorkflow || /github actions/i.test(agent.framework)) return "github";
  if (agent.model || /claude|openai|llm|crewai|agent/i.test(agent.framework)) return "sparkles";
  return "nodes";
}

const ACCENTS = ["#4fb8c9", "#c9a35a", "#8a78e0", "#d9783f", "#3f8f6b", "#3f7fc0", "#c0607a"];
/** A distinct accent per desk: by slot, so neighbors never share one, rotated by the project. */
export function accentFor(slot: number, projectId: string) {
  let h = 0;
  for (const c of projectId) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return ACCENTS[(slot + h) % ACCENTS.length];
}
