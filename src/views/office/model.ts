import type { Agent, Project } from "../../catalog/types";
import type { AuditRecord, ActionsStatus } from "../../actions/types";
import { describeRecord, latestPerAttempt, STAGE_LABEL } from "../../actions/rerun";
import type { ExecutionRecord, Telemetry } from "../../registry/types";
import { mainline } from "../../registry/telemetry";

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
  tier: "central" | "coordinator" | "specialized";
  workflowStep: number;
  zone: "coordination" | "research" | "production" | "quality";
  /** Desk slot, ordered by role level and workflow. */
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

/** Work areas describe responsibilities, independently of live status or seniority. */
export function officeZone(agent: Pick<Agent,"id"> & Partial<Agent>, level: Workstation["tier"]): Workstation["zone"] {
  if(level==="coordinator")return "coordination";
  const text=[agent.name,agent.registry?.title,agent.registry?.subcategory,...(agent.registry?.responsibilities?.tasks??[])].filter(Boolean).join(" ");
  if(/review|quality|validation|validator|audit|security|detection|health|test|ci\/cd/i.test(text))return "quality";
  if(/research|analyst|scout|intelligence|requirements|strategist/i.test(text))return "research";
  if(/coordinat|orchestrat|oversight/i.test(text))return "coordination";
  return "production";
}

/** Desks in rows of three, centered, in manifest order so each agent keeps its desk. */
export function planOffice(project: Pick<Project, "id" | "repository">, agents: (Pick<Agent, "id"> & Partial<Agent>)[]): OfficePlan {
  const ids = new Set(agents.map(a=>a.id));
  const tier = (a: (typeof agents)[number]) => a.registry?.tier ?? (project.id==="ai-ops-atlas" && a.registry?.classification?.type!=="D" ? "central" : (a.registry?.responsibilities?.dependencies??[]).filter(id=>ids.has(id)&&id!==a.id).length>=2 ? "coordinator" : "specialized");
  const phase = (a:(typeof agents)[number]) => Number(/phase\s*(\d+)/i.exec(`${a.trigger??""} ${a.registry?.execution?.schedule??""}`)?.[1]??999);
  const groups = (["central","coordinator","specialized"] as const).map(level=>{
    const remaining=new Map(agents.filter(a=>tier(a)===level).map(a=>[a.id,a]));
    const ordered:typeof agents=[];
    while(remaining.size) {
      const ready=[...remaining.values()].filter(a=>!(a.registry?.responsibilities?.dependencies??[]).some(id=>id!==a.id&&remaining.has(id)));
      const next=(ready.length?ready:[...remaining.values()]).sort((a,b)=>phase(a)-phase(b)||a.id.localeCompare(b.id))[0];
      ordered.push(next);remaining.delete(next.id);
    }
    return {level,ordered};
  }).filter(g=>g.ordered.length);
  const rows=Math.max(1,groups.reduce((n,g)=>n+Math.ceil(g.ordered.length/PER_ROW),0));
  const cols=Math.min(PER_ROW,Math.max(1,agents.length));
  const w=Math.max(8.5,cols*DESK_DX+3.6),d=Math.max(7,rows*DESK_DZ+4.2);
  let rowOffset=0,slot=0;
  const workstations:Workstation[]=groups.flatMap(g=>{
    const desks=g.ordered.map((a,i)=>{
      const row=Math.floor(i/PER_ROW),inRow=Math.min(PER_ROW,g.ordered.length-row*PER_ROW),col=i%PER_ROW;
      return {id:`${project.id}/${a.id}`,agentId:a.id,tier:g.level,zone:officeZone(a,g.level),workflowStep:i+1,slot:slot++,x:(col-(inRow-1)/2)*DESK_DX,z:(rowOffset+row-(rows-1)/2)*DESK_DZ+0.3,ry:0};
    });
    rowOffset+=Math.ceil(g.ordered.length/PER_ROW);return desks;
  });
  return { projectId: project.id, buildingId: `project:${project.id}`, w, d, workstations };
}

/**
 * Agents whose live record is the desktop app's action audit log rather than a workflow or
 * run log. Keyed by agent id, valued by the audit `action` name.
 */
export const ACTION_AGENTS: Record<string, string> = { "atlas-rerun-failed": "rerun_failed_jobs", "atlas-merge-pr": "merge_pull_request" };

/** Whether an action's switch is on in Settings. */
function actionEnabled(action: string, status: ActionsStatus): boolean {
  return action === "merge_pull_request" ? !!status.config.merge_pull_requests?.enabled : status.config.rerun_failed_jobs.enabled;
}

export interface ActionData {
  /** False on the web build and in browsers: the actions live in the desktop app. */
  available: boolean;
  status: ActionsStatus | null;
  audit: AuditRecord[];
}

/** Executions from the action audit log, one per button press, newest first. */
export function actionExecutions(action: string, audit: AuditRecord[]): ExecutionRecord[] {
  return latestPerAttempt(audit.filter((r) => r.action === action)).map((r) => {
    const d = describeRecord(r);
    return { at: r.at, result: d.result, label: `${STAGE_LABEL[r.stage]} · ${d.subject} on ${r.repo}`, url: d.url, source: "github" as const };
  });
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
  if (t.source === "production") {
    const basis = t.executions[0] ?? null;
    if (!t.productionFresh) return { state: "unknown", reason: "Production reporting is stale (no report in 15 minutes).", basis, source: "Production reporting" };
    if (basis?.result === "running" && now - Date.parse(basis.at) >= 15 * 60_000) return { state: "unknown", reason: "Run progress report is stale; heartbeat alone does not establish progress.", basis, source: "Production reporting" };
    const state = basis?.result === "running" ? "working" : basis?.result === "failure" ? "failed" : "idle";
    return { state, reason: "Recent authenticated production report.", basis, source: "Production reporting" };
  }
  // Pull request and Dependabot runs stay in the history but don't decide the desk's state.
  let executions = mainline(t.executions);
  let loaded = t.loaded;
  let source: string | null = t.source === "github" ? "GitHub Actions" : t.source === "atlas-intel" ? "Atlas run log" : t.source === "agent-feed" ? "Pipeline run feed" : null;
  const action = ACTION_AGENTS[agent.id];
  if (action && actions) {
    source = "Atlas action audit log";
    if (!actions.available) return { state: "unknown", reason: "Runs only in the desktop app; its audit log is not visible here.", basis: null, source };
    if (!actions.status) return { state: "unknown", reason: "The action switch and audit log have not loaded.", basis: null, source };
    if (!actionEnabled(action, actions.status)) return { state: "offline", reason: "Switched off in Settings, so it cannot run.", basis: null, source };
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
