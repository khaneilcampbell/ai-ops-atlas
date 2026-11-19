import type { Agent } from "../catalog/types";
import type { RepoState, WorkflowRun } from "../github/types";
import { n8nWorkflowIds } from "../n8n/runs";
import type { N8nRun, N8nSchedule, N8nSnapshot, N8nWorkflowRuns } from "../n8n/types";
import type { StoredTask } from "../tasks/types";
import { nextCron, parseCron, previousCron, zoneOr } from "./cron";

/**
 * Operational truth for each agent identity: which workflows it owns, their schedules, and what its
 * runs are doing. Read only from what really runs them (n8n's run list through the site's read-only
 * key, GitHub Actions runs, and Atlas's own Task Center). The city routine reads this; nothing here
 * reads the city, so a character that is late, lost or hidden never changes a run's state.
 */

/** A run's state as Atlas shows it. Never inferred from animation. */
export type RunStatus = "queued" | "running" | "waiting_approval" | "waiting" | "succeeded" | "failed" | "cancelled";

/** The agent's operational state, from its runs and schedules. */
export type OperationalState = "scheduled" | "queued" | "running" | "waiting_approval" | "succeeded" | "failed" | "cancelled" | "idle";

export const OPERATIONAL_LABEL: Record<OperationalState, string> = {
  scheduled: "Scheduled",
  queued: "Queued",
  running: "Running",
  waiting_approval: "Waiting for approval",
  succeeded: "Succeeded",
  failed: "Failed",
  cancelled: "Cancelled",
  idle: "No scheduled work",
};

export const RUN_LABEL: Record<RunStatus, string> = {
  queued: "Queued",
  running: "Running",
  waiting_approval: "Waiting for approval",
  waiting: "Waiting in n8n",
  succeeded: "Succeeded",
  failed: "Failed",
  cancelled: "Cancelled",
};

/**
 * How far Atlas can vouch for a workflow:
 * - verified: a real run of it was seen (n8n or GitHub run list);
 * - connected: it exists where it runs and is switched on, but no run has been seen yet;
 * - configured: the catalog links it, but Atlas can't see it where it runs (no live data, or not found);
 * - draft: it exists but is switched off (unpublished in n8n);
 */
export type Connection = "verified" | "connected" | "configured" | "draft";
export const CONNECTION_LABEL: Record<Connection, string> = { verified: "Verified by a real run", connected: "Connected, no run seen yet", configured: "Configured, not seen live", draft: "Draft (switched off)" };

export interface OwnedWorkflow {
  /** "n8n:<id>" or "github:<repository>/<file>". */
  key: string;
  source: "n8n" | "github";
  id: string;
  name: string;
  /** The catalog entry (automation or the agent itself) that runs it. */
  agentId: string;
  agentName: string;
  url: string;
  connection: Connection;
  /** Why, in a sentence. */
  note: string;
  published: boolean | null;
  schedules: N8nSchedule[];
  timeZone: string;
  /** Where the time zone came from. */
  zoneSource: "workflow" | "default";
  /** False when n8n is set not to keep successful runs: only failures will ever show. */
  savesSuccess: boolean;
  /** The catalog's own words for when it runs. */
  trigger?: string;
  /** Approval this work needs, as the catalog states it. */
  approval?: string;
  nextRun: number | null;
}

export interface OpRun {
  key: string;
  workflowKey: string;
  workflowName: string;
  agentId: string;
  source: "n8n" | "github" | "task";
  status: RunStatus;
  startedAt: number | null;
  stoppedAt: number | null;
  /** When Atlas first saw this run (kept across reloads, ledger.ts). */
  seenAt: number;
  /** When Atlas first saw it in its current state. */
  statusSeenAt: number;
  /** How it started: trigger, webhook, manual, retry, schedule... */
  mode: string | null;
  retry: boolean;
  url: string | null;
  title: string;
  /** Short reason, such as the task's error. */
  detail?: string;
}

export interface DueRun {
  at: number;
  workflow: OwnedWorkflow;
}

export interface AgentOps {
  personaId: string;
  workflows: OwnedWorkflow[];
  /** Every run seen, newest first (bounded). */
  runs: OpRun[];
  /** Runs still open: running, waiting, queued. */
  open: OpRun[];
  lastResult: OpRun | null;
  next: DueRun | null;
  /** A scheduled time that passed in the last few minutes with no run reported since (the run list lags a few minutes). */
  due: DueRun | null;
  state: OperationalState;
  /** What's missing for this agent's scheduled work to be shown in full. */
  missing: string[];
  /** Whether live n8n data was available to build this. */
  live: boolean;
}

/** Runs still "running" after this long without a stop are shown as unconfirmed, not working forever. */
export const STALE_RUNNING_MS = 6 * 3_600_000;
/** How long after a scheduled time Atlas waits for n8n to report the run. */
export const DUE_GRACE_MS = 12 * 60_000;
/** A finished result counts as the agent's current state for this long. */
const RESULT_FRESH_MS = 24 * 3_600_000;

const ms = (s: string | null | undefined) => (s ? Date.parse(s) : NaN);
const num = (s: string | null | undefined) => {
  const t = ms(s);
  return Number.isFinite(t) ? t : null;
};

export function n8nStatus(r: N8nRun): RunStatus {
  switch (r.status) {
    case "success":
      return "succeeded";
    case "error":
    case "crashed":
      return "failed";
    case "canceled":
      return "cancelled";
    case "running":
      return "running";
    case "new":
      return "queued";
    case "waiting":
      return "waiting";
    default:
      return "failed";
  }
}

export function githubStatus(r: WorkflowRun): RunStatus {
  if (r.status === "queued" || r.status === "waiting" || r.status === "pending" || r.status === "requested") return r.status === "waiting" ? "waiting_approval" : "queued";
  if (r.status !== "completed") return "running";
  if (r.conclusion === "success" || r.conclusion === "skipped" || r.conclusion === "neutral") return "succeeded";
  if (r.conclusion === "cancelled") return "cancelled";
  return "failed";
}

export function taskStatus(t: StoredTask): RunStatus {
  switch (t.status) {
    case "queued":
    case "blocked":
      return "queued";
    case "running":
      return "running";
    case "awaiting_approval":
      return "waiting_approval";
    case "completed":
      return "succeeded";
    case "failed":
      return "failed";
    case "cancelled":
      return "cancelled";
  }
}

/** The catalog entries whose work this persona owns: itself, and automations `owned_by` it. Retired entries are left out. */
export function ownedEntries(agents: readonly Agent[], personaId: string): Agent[] {
  const me = agents.find((a) => a.id === personaId);
  if (!me || me.status === "retired") return [];
  return [me, ...agents.filter((a) => a.ownedBy === personaId && a.status !== "retired")];
}

export interface OpsInput {
  agents: readonly Agent[];
  /** The ready n8n summary, or null when n8n isn't readable here. */
  n8n: N8nSnapshot | null;
  repos: Record<string, RepoState>;
  tasks: readonly StoredTask[];
  /** Persisted first-seen times by run key (ledger.ts). Missing keys count as seen now. */
  seen: ReadonlyMap<string, number>;
  /** Persona of each task's agent (automations and skills resolve to their persona). */
  personaOf: (agentId: string) => string;
  now: number;
}

const n8nUrl = (instance: string, wf: string, run?: string) => `${instance}/workflow/${wf}${run ? `/executions/${run}` : ""}`;

function nextOf(w: Pick<OwnedWorkflow, "schedules" | "timeZone">, after: number): number | null {
  let best: number | null = null;
  for (const s of w.schedules) {
    const c = parseCron(s.cron);
    const t = c && nextCron(c, w.timeZone, after, 400, s.everyWeeks ?? 1);
    if (t !== null && t !== undefined && (best === null || t < best)) best = t;
  }
  return best;
}

function previousOf(w: Pick<OwnedWorkflow, "schedules" | "timeZone">, at: number, windowMs: number): number | null {
  let best: number | null = null;
  for (const s of w.schedules) {
    const c = parseCron(s.cron);
    const t = c && previousCron(c, w.timeZone, at, windowMs, s.everyWeeks ?? 1);
    if (t !== null && t !== undefined && (best === null || t > best)) best = t;
  }
  return best;
}

/** One persona's workflows, runs and state. Pure: the same inputs always give the same answer. */
export function agentOps(personaId: string, input: OpsInput): AgentOps {
  const { agents, n8n, repos, tasks, seen, now } = input;
  const live = n8n?.state === "ok";
  const byId = new Map<string, N8nWorkflowRuns>(live ? n8n.workflows.map((w) => [w.id, w]) : []);
  const instance = live ? n8n.instance : "https://khancam15.app.n8n.cloud";
  const entries = ownedEntries(agents, personaId);
  const workflows: OwnedWorkflow[] = [];
  const runs: OpRun[] = [];
  const missing: string[] = [];
  const seenAt = (key: string) => seen.get(key) ?? now;

  for (const a of entries) {
    const approval = a.registry?.governance?.approval;
    for (const id of n8nWorkflowIds(a)) {
      const key = `n8n:${id}`;
      if (workflows.some((w) => w.key === key)) continue;
      const w = byId.get(id);
      const timeZone = zoneOr(w?.timezone);
      const sawRun = !!w?.runs.length;
      const connection: Connection = !w ? "configured" : !w.active ? "draft" : sawRun ? "verified" : "connected";
      const savesSuccess = w?.savesSuccess !== false;
      const note = !live
        ? "Live n8n data isn't readable here, so Atlas only has the catalog's link."
        : !w
          ? "The catalog links this workflow, but n8n doesn't list it (deleted or archived)."
          : !w.active
            ? "Unpublished in n8n: its triggers are off."
            : sawRun
              ? `n8n reported a ${w.runs[0].status} run ${w.runs[0].startedAt ? "on " + new Date(w.runs[0].startedAt).toISOString().slice(0, 16).replace("T", " ") + " UTC" : ""}`.trim()
              : savesSuccess
                ? "Published in n8n; no run in the recent run list yet."
                : "Published in n8n, but it is set not to save successful runs, so only failures can ever show.";
      const ow: OwnedWorkflow = {
        key,
        source: "n8n",
        id,
        name: w?.name ?? a.links.find((l) => l.url.includes(id))?.label ?? id,
        agentId: a.id,
        agentName: a.name,
        url: n8nUrl(instance, id),
        connection,
        note,
        published: w ? w.active : null,
        schedules: w?.active ? (w.schedules ?? []) : [],
        timeZone,
        zoneSource: w?.timezone ? "workflow" : "default",
        savesSuccess,
        trigger: a.trigger,
        ...(approval ? { approval } : {}),
        nextRun: null,
      };
      ow.nextRun = nextOf(ow, now);
      workflows.push(ow);
      if (live && w && !savesSuccess) missing.push(`${ow.name}: n8n doesn't keep successful runs (Settings → Save successful production executions), so Atlas can confirm only its failures.`);
      for (const r of w?.runs ?? []) {
        const rkey = `n8n:${id}:${r.id}`;
        const status = n8nStatus(r);
        const started = num(r.startedAt);
        // A "running" run with no stop after hours is n8n's record of a lost run, not real work.
        const stale = status === "running" && started !== null && now - started > STALE_RUNNING_MS;
        runs.push({
          key: rkey,
          workflowKey: key,
          workflowName: ow.name,
          agentId: a.id,
          source: "n8n",
          status: stale ? "failed" : status,
          startedAt: started,
          stoppedAt: num(r.stoppedAt),
          seenAt: seenAt(rkey), statusSeenAt: seenAt(`${rkey}:${status}`),
          mode: r.mode,
          retry: r.mode === "retry",
          url: n8nUrl(instance, id, r.id),
          title: ow.name,
          ...(stale ? { detail: "n8n still lists it as running hours later; treated as lost" } : status === "waiting" ? { detail: r.waitTill ? `Resumes on its own at ${r.waitTill}` : "Paused at an n8n Wait step until someone answers or a call resumes it" } : {}),
        });
      }
    }
    const file = a.observe?.githubWorkflow;
    if (file) {
      const key = `github:${a.repository}/${file}`;
      if (!workflows.some((w) => w.key === key)) {
        const state = repos[a.repository];
        const data = state && "data" in state ? state.data : undefined;
        const gh = data?.workflowRuns?.[file] ?? [];
        const url = `https://github.com/${a.repository}/actions/workflows/${file}`;
        workflows.push({
          key,
          source: "github",
          id: file,
          name: `${a.name} (${file})`,
          agentId: a.id,
          agentName: a.name,
          url,
          connection: gh.length ? "verified" : data ? "connected" : "configured",
          note: gh.length ? `GitHub reported a run on ${gh[0].createdAt.slice(0, 16).replace("T", " ")} UTC.` : data ? "GitHub answered, but no run of this workflow is in the recent list." : "GitHub data hasn't loaded.",
          published: null,
          schedules: [],
          timeZone: zoneOr(null),
          zoneSource: "default",
          savesSuccess: true,
          trigger: a.trigger,
          ...(approval ? { approval } : {}),
          nextRun: null,
        });
        for (const r of gh.slice(0, 5)) {
          const rkey = `github:${a.repository}:${r.id ?? r.url}`;
          const status = githubStatus(r);
          runs.push({ key: rkey, workflowKey: key, workflowName: file, agentId: a.id, source: "github", status, startedAt: num(r.createdAt), stoppedAt: status === "succeeded" || status === "failed" || status === "cancelled" ? num(r.createdAt) : null, seenAt: seenAt(rkey), statusSeenAt: seenAt(`${rkey}:${status}`), mode: r.event, retry: (r.attempt ?? 1) > 1, url: r.url, title: `${r.name} on ${r.branch}` });
        }
      }
    }
  }
  if (!live) missing.push("Live n8n runs aren't readable here (they come through the hosted site or the Mac app's website sync).");

  // Task Center: work assigned to this persona (its own id or an automation it owns).
  for (const t of tasks) {
    if (!t.agentId || input.personaOf(t.agentId) !== personaId) continue;
    const status = taskStatus(t);
    const key = `task:${t.id}`;
    const att = t.attempts[t.attempts.length - 1];
    runs.push({
      key,
      workflowKey: t.workflow ? `${t.workflow.kind}:${t.workflow.id}` : key,
      workflowName: t.workflow?.label ?? "Task",
      agentId: t.agentId,
      source: "task",
      status,
      startedAt: num(t.startedAt) ?? num(t.createdAt),
      stoppedAt: num(t.completedAt),
      seenAt: seenAt(key), statusSeenAt: seenAt(`${key}:${status}`),
      mode: t.source,
      retry: (att?.number ?? 1) > 1,
      url: att?.externalUrl ?? null,
      title: t.title,
      ...(t.error ? { detail: t.error } : t.status === "blocked" ? { detail: "Blocked by a dependency" } : {}),
    });
  }

  runs.sort((a, b) => (b.startedAt ?? b.seenAt) - (a.startedAt ?? a.seenAt));
  const open = runs.filter((r) => r.status === "running" || r.status === "queued" || r.status === "waiting" || r.status === "waiting_approval");
  const lastResult = runs.find((r) => r.status === "succeeded" || r.status === "failed" || r.status === "cancelled") ?? null;

  let next: DueRun | null = null;
  for (const w of workflows) if (w.nextRun !== null && (!next || w.nextRun < next.at)) next = { at: w.nextRun, workflow: w };

  // A schedule that came due a moment ago: n8n's list lags, so wait before saying anything about it.
  let due: DueRun | null = null;
  for (const w of workflows) {
    const t = previousOf(w, now, DUE_GRACE_MS);
    if (t === null) continue;
    const reported = runs.some((r) => r.workflowKey === w.key && (r.startedAt ?? r.seenAt) >= t - 60_000);
    if (!reported && (!due || t > due.at)) due = { at: t, workflow: w };
  }

  const state: OperationalState = open.some((r) => r.status === "waiting_approval")
    ? "waiting_approval"
    : open.some((r) => r.status === "running" || r.status === "waiting")
      ? "running"
      : open.length
        ? "queued"
        : due
          ? "scheduled"
          : lastResult && now - (lastResult.stoppedAt ?? lastResult.seenAt) < RESULT_FRESH_MS
            ? lastResult.status === "succeeded"
              ? "succeeded"
              : lastResult.status === "failed"
                ? "failed"
                : "cancelled"
            : next
              ? "scheduled"
              : "idle";

  return { personaId, workflows, runs: runs.slice(0, 40), open, lastResult, next, due, state, missing, live };
}

/** What the ledger should record from these runs (first sightings). */
export function sightingsOf(runs: readonly OpRun[]) {
  return runs.map((r) => ({ key: r.key, status: r.status, finished: r.status === "succeeded" || r.status === "failed" || r.status === "cancelled", stoppedAt: r.stoppedAt, startedAt: r.startedAt }));
}
