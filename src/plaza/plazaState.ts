import type { N8nState } from "../n8n/runs";
import { n8nHealth, n8nWorkflowIds } from "../n8n/runs";
import { AUTOMATIONS_SOURCE, N8N_SOURCE } from "../registry/telemetry";
import type { N8nRun } from "../n8n/types";
import type { StoredTask } from "../tasks/types";
import type { WorkflowRun } from "../workflows/types";
import { buildingDisplayName } from "../modules/names";

/** Map keys of the buildings an agent can be given a room in (catalog/workplaces.ts), by catalog name. */
const WORKPLACE_KEYS: Readonly<Record<string, string>> = { "Benjaire Marketing Agency": "service:benjaire-marketing" };

/**
 * Atlas Automation Plaza: what the plaza shows, from the automation data Atlas already reads.
 * Pure, so every state can be tested. Three sources, all existing:
 *
 * - agent runtimes (office/activity.ts useRuntimes): the verified run states that light the
 *   buildings (GitHub runs, the agent feed, the app's own logs);
 * - Task Center tasks on this device (tasks/store.ts), with the workflow step a task carries when
 *   it belongs to a live workflow run (workflows/runs.ts);
 * - n8n runs from the Workflow Automation Plant feed (n8n/runs.ts, polled every 2 minutes).
 *
 * Nothing here is invented: no progress, no queue that a source didn't report, no building that
 * the catalog doesn't name. With no live source, the plaza reads "Status unavailable".
 */

/** An n8n summary older than this is stale: its "running" runs may long have finished. */
export const N8N_FRESH_MS = 10 * 60_000;

/**
 * A test run started by hand in the n8n editor that has sat at a wait step this long was left behind,
 * not real work (Khaneil, 2026-11-18: a Nov 13 test showed "Running for 124 h"). Runs from triggers,
 * webhooks, forms and agents keep showing however long they wait.
 */
export const MANUAL_WAIT_ABANDONED_MS = 24 * 60 * 60_000;

/** True for a hand-started editor test still waiting after a day. */
export function abandonedTest(r: Pick<N8nRun, "mode" | "status" | "startedAt">, now: number): boolean {
  if (r.mode !== "manual" || r.status !== "waiting" || !r.startedAt) return false;
  const age = now - Date.parse(r.startedAt);
  return Number.isFinite(age) && age > MANUAL_WAIT_ABANDONED_MS;
}

export type ItemStatus = "running" | "waiting" | "queued" | "blocked" | "awaiting_approval" | "failed";

export const ITEM_STATUS_LABEL: Record<ItemStatus, string> = {
  running: "Running",
  waiting: "Waiting",
  queued: "Queued",
  blocked: "Blocked",
  awaiting_approval: "Awaiting approval",
  failed: "Failed",
};

export interface PlazaLink {
  label: string;
  /** An outside page (GitHub run, n8n execution). https only. */
  url?: string;
  /** Opens the Task Center filtered to this task id. */
  taskId?: string;
}

export interface PlazaItem {
  /** Stable across polls: task:<id>, agent:<id> or n8n:<execution id>. */
  id: string;
  source: "task" | "agent" | "n8n";
  title: string;
  status: ItemStatus;
  /** Why, in plain words, from the source. */
  detail: string;
  agentId?: string;
  agentName?: string;
  /** The map key of the building the work belongs to (project:<id>), only when the catalog says. */
  buildingKey?: string;
  buildingName?: string;
  /** The current workflow step, only when the source supplies one. */
  step?: string;
  /** When the work started, only when the source supplies it. */
  startedAt?: string;
  links: PlazaLink[];
}

export type SourceState = "live" | "stale" | "off";

export interface PlazaSource {
  id: "agents" | "tasks" | "n8n";
  label: string;
  state: SourceState;
  note: string;
}

export interface PlazaSnapshot {
  /** "live" when at least one execution source answered with current data. */
  connection: "live" | "unavailable";
  /** True only for the labelled sample preview, never for live data. */
  preview: boolean;
  sources: PlazaSource[];
  running: PlazaItem[];
  queued: PlazaItem[];
  attention: PlazaItem[];
  /** Final states Atlas can see now, by item id, so a run leaving "running" can be told apart. */
  finished: ReadonlyMap<string, "completed" | "failed" | "cancelled">;
}

/** The parts of an agent this needs (catalog/types.ts Agent). */
export interface AgentLike {
  id: string;
  name: string;
  projectId: string;
  /** Where the agent works, when its manifest seats it outside its project's building. */
  workplace?: { building: string };
  links?: { label: string; url: string }[];
  /** The AI agent that owns this automation (catalog owned_by): the plaza names it as the one doing the work. */
  ownedBy?: string;
}

/** The parts of an agent runtime this needs (office/model.ts Runtime). */
export interface RuntimeLike {
  state: string;
  reason: string;
  source: string | null;
  basis: { at: string; result: string; label: string; url?: string } | null;
}

export interface PlazaInputs {
  agents: readonly AgentLike[];
  projectNames: ReadonlyMap<string, string>;
  runtimes: ReadonlyMap<string, RuntimeLike>;
  tasks: readonly StoredTask[];
  runs: readonly WorkflowRun[];
  n8n: N8nState;
  now: number;
}

const LIVE_RUNTIME = new Set(["working", "awaiting", "failed", "idle"]);
const https = (u: string | undefined) => (u && /^https:\/\//.test(u) ? u : undefined);

/** Where each task sits in a live workflow run: the run's name and the step's title. */
function stepsOf(runs: readonly WorkflowRun[]): Map<string, { run: string; step: string }> {
  const out = new Map<string, { run: string; step: string }>();
  for (const r of runs) {
    const nodes = new Map(r.snapshot.nodes.map((n) => [n.id, n]));
    for (const [nodeId, taskId] of Object.entries(r.nodeTasks)) {
      const n = nodes.get(nodeId);
      if (n) out.set(taskId, { run: r.snapshot.name, step: n.title });
    }
  }
  return out;
}

function n8nSource(n8n: N8nState, now: number): PlazaSource {
  const label = "n8n runs";
  if (n8n.value?.state === "ok") {
    const age = now - Date.parse(n8n.value.fetchedAt);
    if (Number.isFinite(age) && age <= N8N_FRESH_MS) return { id: "n8n", label, state: "live", note: `Read from ${n8n.value.instance.replace(/^https:\/\//, "")}.` };
    return { id: "n8n", label, state: "stale", note: "The last n8n summary is more than 10 minutes old, so its runs are not counted." };
  }
  if (n8n.value?.state === "not-configured") return { id: "n8n", label, state: "off", note: `Not set up: ${n8n.value.need}` };
  if (n8n.state === "loading") return { id: "n8n", label, state: "off", note: "Loading." };
  return { id: "n8n", label, state: "off", note: n8n.message ?? "n8n runs are read by the hosted site and the Mac app." };
}

/** Builds what the plaza shows from Atlas's own automation data. */
export function plazaSnapshot(i: PlazaInputs): PlazaSnapshot {
  const agentById = new Map(i.agents.map((a) => [a.id, a]));
  /** The agent the plaza names for a piece of work: an automation's owning agent, else itself. */
  const lead = (a: AgentLike) => (a.ownedBy && agentById.get(a.ownedBy)) || a;
  const who = (agentId: string | undefined, fallbackName?: string, buildingId?: string) => {
    const a = agentId ? agentById.get(agentId) : undefined;
    // An agent with a workplace does its work there (Product Lab: Growth & Marketing Studio), so
    // the plaza names that building, by its current display name, not its project's headquarters.
    const place = a?.workplace ? WORKPLACE_KEYS[a.workplace.building] : undefined;
    if (a && place) return { agentId: a.id, agentName: a.name, buildingKey: place, buildingName: buildingDisplayName(place, a.workplace!.building) };
    const projectId = a?.projectId ?? (buildingId && i.projectNames.has(buildingId) ? buildingId : undefined);
    return {
      agentId: a?.id ?? agentId,
      agentName: a?.name ?? fallbackName,
      buildingKey: projectId ? `project:${projectId}` : undefined,
      buildingName: projectId ? i.projectNames.get(projectId) : undefined,
    };
  };

  // Sources.
  let liveAgents = 0;
  let staleAgents = 0;
  for (const r of i.runtimes.values()) {
    if (LIVE_RUNTIME.has(r.state)) liveAgents++;
    else if (r.state === "stale") staleAgents++;
  }
  const agents: PlazaSource = liveAgents
    ? { id: "agents", label: "Agent runs", state: "live", note: `${liveAgents} agent${liveAgents === 1 ? "" : "s"} reporting current run data.` }
    : staleAgents
      ? { id: "agents", label: "Agent runs", state: "stale", note: "Agents last reported longer ago than they should." }
      : { id: "agents", label: "Agent runs", state: "off", note: "No agent run data has been received in this session." };
  const n8n = n8nSource(i.n8n, i.now);
  const tasks: PlazaSource = { id: "tasks", label: "Task Center", state: "live", note: `${i.tasks.length} task${i.tasks.length === 1 ? "" : "s"} recorded on this device.` };

  const steps = stepsOf(i.runs);
  const running: PlazaItem[] = [];
  const queued: PlazaItem[] = [];
  const attention: PlazaItem[] = [];
  const finished = new Map<string, "completed" | "failed" | "cancelled">();
  /** Items by agent, so one piece of work seen by two sources shows once. */
  const runningByAgent = new Map<string, PlazaItem>();
  const attentionByAgent = new Map<string, PlazaItem>();

  // 1. Task Center tasks: the most detailed record, so they go first.
  for (const t of i.tasks) {
    const base = who(t.agentId, t.agentName, t.buildingId);
    const at = steps.get(t.id);
    const attempt = t.attempts[t.attempts.length - 1];
    const links: PlazaLink[] = [{ label: "Open in Task Center", taskId: t.id }];
    const ext = https(attempt?.externalUrl);
    if (ext) links.push({ label: attempt?.executor === "n8n" ? "n8n execution" : attempt?.executor === "github" ? "GitHub run" : "Execution", url: ext });
    const item = (status: ItemStatus, detail: string): PlazaItem => ({
      id: `task:${t.id}`,
      source: "task",
      title: at ? `${at.run}` : t.title,
      status,
      detail,
      ...base,
      step: at?.step ?? (at ? undefined : t.workflow?.label),
      startedAt: t.startedAt ?? attempt?.startedAt,
      links,
    });
    if (t.status === "running") {
      const it = item("running", at ? `Task "${t.title}" is running.` : "Running in the Task Center.");
      running.push(it);
      if (it.agentId && !runningByAgent.has(it.agentId)) runningByAgent.set(it.agentId, it);
    } else if (t.status === "queued") queued.push(item("queued", "Queued in the Task Center."));
    else if (t.status === "blocked") {
      const it = item("blocked", t.error ? `Blocked: ${t.error}` : "Waiting on the tasks it depends on.");
      // Waiting on earlier steps is normal flow, not a problem; only a stated reason needs a person.
      if (t.error) attention.push(it);
      else queued.push(it);
    } else if (t.status === "awaiting_approval") {
      const it = item("awaiting_approval", "Waiting for Khaneil's approval before it can run.");
      attention.push(it);
      if (it.agentId) attentionByAgent.set(it.agentId, it);
    } else if (t.status === "failed") {
      const it = item("failed", t.error ? `Failed: ${t.error}` : "Failed. The Task Center has the attempt history.");
      attention.push(it);
      if (it.agentId) attentionByAgent.set(it.agentId, it);
    }
    if (t.status === "completed" || t.status === "failed" || t.status === "cancelled") finished.set(`task:${t.id}`, t.status);
  }

  // 2. Agent runtimes: verified runs that no task already covers. n8n workflows come from their
  // runs in step 3, and an owning agent's rolled-up runtime repeats its automations', so both skip.
  if (agents.state === "live") {
    for (const [agentId, r] of i.runtimes) {
      const a = agentById.get(agentId);
      if (!a || r.source === N8N_SOURCE || r.source?.startsWith(AUTOMATIONS_SOURCE)) continue;
      const base = who(lead(a).id);
      const url = https(r.basis?.url);
      const link: PlazaLink[] = url ? [{ label: r.source === "github" ? "GitHub run" : "Run details", url }] : [];
      if (r.state === "working") {
        const known = runningByAgent.get(agentId);
        if (known) {
          for (const l of link) if (!known.links.some((k) => k.url === l.url)) known.links.push(l);
          continue;
        }
        const it: PlazaItem = { id: `agent:${agentId}`, source: "agent", title: a.name, status: "running", detail: r.reason, ...base, startedAt: r.basis?.at, links: link };
        running.push(it);
        runningByAgent.set(agentId, it);
      } else if ((r.state === "failed" || r.state === "awaiting") && !attentionByAgent.has(agentId)) {
        const it: PlazaItem = { id: `agent:${agentId}`, source: "agent", title: a.name, status: r.state === "failed" ? "failed" : "awaiting_approval", detail: r.reason, ...base, links: link };
        attention.push(it);
        attentionByAgent.set(agentId, it);
      }
      if (r.state === "idle" && r.basis?.result === "success") finished.set(`agent:${agentId}`, "completed");
      if (r.state === "failed") finished.set(`agent:${agentId}`, "failed");
    }
  }

  // 3. n8n runs, only from a current summary.
  if (n8n.state === "live" && i.n8n.value?.state === "ok") {
    const instance = i.n8n.value.instance;
    const owner = new Map<string, AgentLike>();
    for (const a of i.agents) for (const id of n8nWorkflowIds({ links: (a.links ?? []) as Parameters<typeof n8nWorkflowIds>[0]["links"] })) if (!owner.has(id)) owner.set(id, a);
    for (const w of i.n8n.value.workflows) {
      const a = owner.get(w.id);
      const base = a ? who(lead(a).id) : {};
      const execUrl = (r: N8nRun) => https(`${instance}/workflow/${w.id}/executions/${r.id}`);
      for (const r of w.runs) {
        const id = `n8n:${r.id}`;
        if (r.status === "success") finished.set(id, "completed");
        else if (r.status === "error" || r.status === "crashed") finished.set(id, "failed");
        else if (r.status === "canceled") finished.set(id, "cancelled");
        if (r.status !== "running" && r.status !== "waiting" && r.status !== "new") continue;
        if (abandonedTest(r, i.now)) continue;
        const link: PlazaLink = { label: "n8n execution", url: execUrl(r) };
        if (r.status === "new") {
          queued.push({ id, source: "n8n", title: w.name, status: "queued", detail: "n8n has the run queued.", ...base, links: [link] });
          continue;
        }
        const known = a ? runningByAgent.get(a.id) : undefined;
        if (known) {
          if (!known.links.some((k) => k.url === link.url)) known.links.push(link);
          continue;
        }
        const it: PlazaItem = {
          id,
          source: "n8n",
          title: w.name,
          status: r.status === "waiting" ? "waiting" : "running",
          detail: r.status === "waiting" ? "The n8n run is paused at a wait step." : "Running in n8n.",
          ...base,
          startedAt: r.startedAt ?? undefined,
          links: [link],
        };
        running.push(it);
        if (a) runningByAgent.set(a.id, it);
      }
      if (n8nHealth(w) === "failing" && !(a && attentionByAgent.has(a.id))) {
        const last = w.runs.find((r) => r.status === "error" || r.status === "crashed");
        const it: PlazaItem = { id: `n8n-wf:${w.id}`, source: "n8n", title: w.name, status: "failed", detail: "Its latest finished n8n run failed.", ...base, links: last ? [{ label: "Failed n8n execution", url: execUrl(last) }] : [] };
        attention.push(it);
        if (a) attentionByAgent.set(a.id, it);
      }
    }
  }

  const connection = agents.state === "live" || n8n.state === "live" ? "live" : "unavailable";
  const byStart = (a: PlazaItem, b: PlazaItem) => (a.startedAt ?? "").localeCompare(b.startedAt ?? "");
  return { connection, preview: false, sources: [agents, n8n, tasks], running: running.sort(byStart), queued, attention, finished };
}

/** The sign's status line. Counts only from a live source; never the reference image's sample. */
export function signText(s: PlazaSnapshot): { status: string; note: string | null; tone: "live" | "attention" | "unavailable" | "preview" } {
  const counts = `${s.running.length} running · ${s.queued.length} queued`;
  if (s.preview) return { status: `Sample preview · ${counts}`, note: "Not live data", tone: "preview" };
  if (s.connection === "unavailable") return { status: "Status unavailable", note: "No live automation data", tone: "unavailable" };
  const n = s.attention.length;
  if (n) return { status: counts, note: `${n} need${n === 1 ? "s" : ""} attention: ${s.attention[0].title} ${ITEM_STATUS_LABEL[s.attention[0].status].toLowerCase()}`, tone: "attention" };
  return { status: counts, note: null, tone: "live" };
}

/** One sentence for screen readers and the plaza's text equivalent. */
export function plazaSummary(s: PlazaSnapshot): string {
  const t = signText(s);
  if (s.preview) return `Atlas Automation Plaza, sample preview, not live data: ${s.running.length} running, ${s.queued.length} queued, ${s.attention.length} needing attention.`;
  if (s.connection === "unavailable") return "Atlas Automation Plaza: status unavailable. No automation source has current data.";
  const idle = !s.running.length && !s.queued.length ? " Idle." : "";
  return `Atlas Automation Plaza: ${s.running.length} running, ${s.queued.length} queued.${t.note ? ` ${t.note}.` : ""}${idle}`;
}

export type PlazaEventKind = "start" | "handoff" | "complete" | "attention";

export interface PlazaEvent {
  /** Unique per transition, so a repeated poll never replays it. */
  key: string;
  kind: PlazaEventKind;
  itemId: string;
  source: PlazaItem["source"];
  agentId?: string;
  /** The building a handoff pulse travels to, when the catalog names one. */
  buildingKey?: string;
}

/** How long a fired event key is remembered, so the same change never fires twice. */
export const EVENT_MEMORY_MS = 15 * 60_000;

/** A run starting this soon after another agent in the same building finished is a handoff. */
export const HANDOFF_MS = 90_000;

/**
 * The plaza events a change between two snapshots calls for. The first snapshot is a baseline
 * (no events), a preview never mixes with live data, and `seen` drops anything already fired.
 * `recent` remembers completions per building, for handoffs.
 */
export function plazaEvents(
  prev: PlazaSnapshot | null,
  next: PlazaSnapshot,
  seen: Map<string, number>,
  recent: Map<string, { agentId?: string; at: number }>,
  now: number,
): PlazaEvent[] {
  for (const [k, at] of seen) if (now - at > EVENT_MEMORY_MS) seen.delete(k);
  if (!prev || prev.preview !== next.preview || next.connection === "unavailable") return [];
  const out: PlazaEvent[] = [];
  const fire = (e: Omit<PlazaEvent, "key">, stamp: string) => {
    const key = `${e.kind}:${e.itemId}:${stamp}`;
    if (seen.has(key)) return;
    seen.set(key, now);
    out.push({ ...e, key });
  };
  const wasRunning = new Map(prev.running.map((r) => [r.id, r]));
  const isRunning = new Set(next.running.map((r) => r.id));
  const wasAttention = new Set(prev.attention.map((a) => a.id));

  // Finished first, so a start right after it in the same building reads as a handoff.
  for (const [id, r] of wasRunning) {
    if (isRunning.has(id)) continue;
    const end = next.finished.get(id);
    if (end === "completed") {
      fire({ kind: "complete", itemId: id, source: r.source, agentId: r.agentId, buildingKey: r.buildingKey }, r.startedAt ?? "");
      recent.set(r.buildingKey ?? "", { agentId: r.agentId, at: now });
    }
  }
  for (const r of next.running) {
    if (wasRunning.has(r.id)) continue;
    const last = r.buildingKey ? recent.get(r.buildingKey) : undefined;
    const handoff = !!last && last.agentId !== r.agentId && now - last.at <= HANDOFF_MS;
    fire({ kind: handoff ? "handoff" : "start", itemId: r.id, source: r.source, agentId: r.agentId, buildingKey: r.buildingKey }, r.startedAt ?? "");
  }
  for (const a of next.attention) {
    if (wasAttention.has(a.id)) continue;
    fire({ kind: "attention", itemId: a.id, source: a.source, agentId: a.agentId, buildingKey: a.buildingKey }, a.status);
  }
  for (const [k, v] of recent) if (now - v.at > HANDOFF_MS) recent.delete(k);
  return out;
}

/** The plaza's neighbours on the map (plazaPlan.ts paths), used only to pick the preview's sample agents. */
export const PREVIEW_PROJECTS = ["portfolio-site", "commerce-pipeline", "github-profile", "soc-lab"];

/** The sample preview: clearly labelled, fixed content, never mixed with live data. */
export function previewSnapshot(agents: readonly AgentLike[], projectNames: ReadonlyMap<string, string>, now: number, phase: number): PlazaSnapshot {
  // Agents from the plaza's neighbours first, so the sample handoffs have a gold path to travel.
  const near = (a: AgentLike) => (PREVIEW_PROJECTS.includes(a.projectId) ? 0 : 1);
  const pick = [...agents].sort((a, b) => near(a) - near(b) || PREVIEW_PROJECTS.indexOf(a.projectId) - PREVIEW_PROJECTS.indexOf(b.projectId)).slice(0, 4);
  const at = (min: number) => new Date(now - min * 60_000).toISOString();
  const item = (n: number, status: ItemStatus, title: string, step: string | undefined, min: number | undefined): PlazaItem | null => {
    const a = pick[n];
    if (!a) return null;
    return {
      id: `preview:${n}:${phase}`,
      source: "task",
      title,
      status,
      detail: "Sample preview. Not a real run.",
      agentId: a.id,
      agentName: a.name,
      buildingKey: `project:${a.projectId}`,
      buildingName: projectNames.get(a.projectId),
      step,
      startedAt: min === undefined ? undefined : at(min),
      links: [],
    };
  };
  const running = [item(0, "running", "Sample: weekly report", "Gather sources", 4), item(1, "running", "Sample: site health check", undefined, 1)].filter((x): x is PlazaItem => !!x);
  const queued = [item(2, "queued", "Sample: release notes", undefined, undefined)].filter((x): x is PlazaItem => !!x);
  const attention = [item(3, "awaiting_approval", "Sample: customer email", "Approve send", undefined)].filter((x): x is PlazaItem => !!x);
  return {
    connection: "live",
    preview: true,
    sources: [{ id: "tasks", label: "Sample preview", state: "off", note: "Made-up examples to show how the plaza looks. Nothing here is a real run." }],
    running,
    queued,
    attention,
    finished: new Map(),
  };
}
