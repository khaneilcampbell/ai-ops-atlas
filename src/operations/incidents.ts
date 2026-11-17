import { admitEvent, safeText } from "./events";
import { SEVERITIES, SEVERITY_RANK, type EventSystem, type Incident, type OpsEvent, type OpsEventType, type OpsFile, type Severity } from "./types";

// Incident detection with fixed rules: deduplication, grouping by correlation id across systems,
// severity from a table, repeat escalation, thresholds for transient noise and a cooldown so a
// flapping signal reopens its incident instead of making new ones. No model calls.

export interface Rule {
  severity: Severity;
  /** Expected to blip: needs `threshold` events for the same key inside WINDOW_MS before an incident. */
  transient?: boolean;
  threshold?: number;
  title: string;
}

export const RULES: Record<OpsEventType, Rule> = {
  "workflow.failed": { severity: "high", title: "Workflow failed" },
  "repo.health_changed": { severity: "medium", title: "Repository health changed" },
  "service.unhealthy": { severity: "high", title: "Service unhealthy" },
  "task.failed": { severity: "medium", title: "Task failed" },
  "task.stalled": { severity: "medium", title: "Task stalled past its timeout" },
  "task.invalid_output": { severity: "medium", title: "Invalid agent output" },
  "agent.failing": { severity: "high", title: "Agent failing" },
  "agent.silent": { severity: "medium", title: "Agent stopped reporting" },
  "agent.eval_failed": { severity: "low", title: "Agent evaluation below standard" },
  "agent.unauthorized": { severity: "critical", title: "Unauthorized action attempt" },
  "integration.failing": { severity: "medium", transient: true, threshold: 2, title: "Integration failing" },
  "integration.stale": { severity: "low", transient: true, threshold: 2, title: "Integration answering late" },
  "budget.warning": { severity: "medium", title: "Budget almost used" },
  "budget.exceeded": { severity: "high", title: "Budget used up" },
  "goal.deadline": { severity: "high", title: "Goal deadline" },
  "goal.stale": { severity: "medium", title: "Goal progress stale" },
  "goal.blocked": { severity: "medium", title: "Goal blocked on approval" },
  "goal.agent_unavailable": { severity: "high", title: "Goal agent unavailable" },
  "goal.dependency_failed": { severity: "high", title: "Goal step failed" },
  "goal.missing_deliverable": { severity: "medium", title: "Expected deliverable missing" },
};

export const WINDOW_MS = 60 * 60_000;
export const COOLDOWN_MS = 30 * 60_000;
export const REPEAT_THRESHOLD = 3;
export const MAX_EVENTS = 300;
export const MAX_INCIDENTS = 200;
const DAY = 86_400_000;

/** One level more severe, never above critical. */
export const raise = (s: Severity): Severity => SEVERITIES[Math.max(0, SEVERITY_RANK[s] - 1)];
const worst = (a: Severity, b: Severity): Severity => (SEVERITY_RANK[a] <= SEVERITY_RANK[b] ? a : b);
const CLOSED = new Set<Incident["state"]>(["resolved", "dismissed"]);

/** Severity of an event from the table; the event's own severity can only make it worse, never milder. */
export const classify = (e: Pick<OpsEvent, "type" | "severity">): Severity => worst(RULES[e.type].severity, e.severity);

export interface IngestResult {
  file: OpsFile;
  created: Incident[];
  reopened: Incident[];
  rejected: string[];
}

const uniq = <T,>(xs: T[]) => [...new Set(xs)];
let seq = 0;
const incidentId = (now: number) => `inc_${now.toString(36)}_${(seq++).toString(36)}`;

function detail(e: OpsEvent): string {
  const p = e.payload;
  return safeText(String(p.detail ?? p.title ?? `${e.type} on ${e.resource}`), 200);
}

function attach(i: Incident, e: OpsEvent, now: number): Incident {
  const evidence = i.evidence.some((x) => x.system === e.system && x.resource === e.resource && x.type === e.type) ? i.evidence : [...i.evidence, { system: e.system, identity: e.identity, resource: e.resource, type: e.type, at: e.at, detail: detail(e), ...(e.artifactUrl ? { url: e.artifactUrl } : {}) }].slice(-20);
  const count = i.count + 1;
  const repeated = i.repeated || (count >= REPEAT_THRESHOLD && now - Date.parse(i.firstAt) <= DAY);
  const sev = worst(i.severity, classify(e));
  return {
    ...i,
    severity: repeated && !i.repeated ? raise(sev) : sev,
    types: uniq([...i.types, e.type]),
    systems: uniq([...i.systems, e.system]),
    eventIds: [...i.eventIds, e.id].slice(-50),
    evidence,
    lastAt: e.at > i.lastAt ? e.at : i.lastAt,
    count,
    repeated,
    project: i.project ?? e.project,
    ...refs(i, e),
  };
}

function refs(i: Pick<Incident, "taskIds" | "runIds" | "goalIds" | "agentIds">, e: OpsEvent) {
  const p = e.payload;
  const add = (xs: string[], v: unknown) => (typeof v === "string" && v ? uniq([...xs, v]).slice(-20) : xs);
  return { taskIds: add(i.taskIds, p.taskId), runIds: add(i.runIds, p.runId), goalIds: add(i.goalIds, p.goalId), agentIds: add(i.agentIds, p.agentId) };
}

function open(e: OpsEvent, now: number): Incident {
  const base = { taskIds: [], runIds: [], goalIds: [], agentIds: [] };
  return {
    id: incidentId(now),
    key: e.correlationId,
    title: safeText(String(e.payload.title ?? `${RULES[e.type].title}: ${e.resource}`), 140),
    severity: classify(e),
    state: "open",
    project: e.project,
    types: [e.type],
    systems: [e.system],
    eventIds: [e.id],
    evidence: [{ system: e.system, identity: e.identity, resource: e.resource, type: e.type, at: e.at, detail: detail(e), ...(e.artifactUrl ? { url: e.artifactUrl } : {}) }],
    firstAt: e.at,
    lastAt: e.at,
    count: 1,
    repeated: false,
    ...refs(base, e),
    impact: [],
    attemptIds: [],
  };
}

/**
 * Takes raw events through validation, authentication and deduplication, then groups them into
 * incidents. Pure: returns the next file and what changed.
 */
export function ingest(file: OpsFile, raw: readonly unknown[], now: number): IngestResult {
  let f = { ...file, counters: { ...file.counters } };
  const created: Incident[] = [];
  const reopened: Incident[] = [];
  const rejected: string[] = [];
  const seen = new Set(f.events.map((e) => e.dedupKey));
  for (const r of raw) {
    const a = admitEvent(r);
    if (!a.ok) {
      f.counters.events_rejected++;
      rejected.push(a.error);
      continue;
    }
    const e = a.event;
    if (seen.has(e.dedupKey)) {
      f.counters.events_duplicate++;
      continue;
    }
    seen.add(e.dedupKey);
    f.counters.events_received++;
    f = { ...f, events: [...f.events, e].slice(-MAX_EVENTS) };
    const incidents = f.incidents.slice();
    const live = incidents.findIndex((i) => i.key === e.correlationId && !CLOSED.has(i.state));
    if (live >= 0) {
      incidents[live] = attach(incidents[live], e, now);
      f = { ...f, incidents };
      continue;
    }
    // Cooldown: a closed incident for the same thing comes back instead of a new one.
    const recent = incidents.findIndex((i) => i.key === e.correlationId && i.state === "resolved" && i.resolvedAt && now - Date.parse(i.resolvedAt) < COOLDOWN_MS);
    if (recent >= 0) {
      const back: Incident = { ...attach(incidents[recent], e, now), state: "open", verified: undefined, resolution: undefined, resolvedAt: undefined, reopened: (incidents[recent].reopened ?? 0) + 1 };
      incidents[recent] = back;
      reopened.push(back);
      f.counters.incidents_reopened++;
      f = { ...f, incidents };
      continue;
    }
    const rule = RULES[e.type];
    if (rule.transient) {
      const n = f.events.filter((x) => x.correlationId === e.correlationId && x.type === e.type && now - Date.parse(x.at) <= WINDOW_MS).length;
      if (n < (rule.threshold ?? 2)) continue;
    }
    const inc = open(e, now);
    created.push(inc);
    f.counters.incidents_created++;
    f = { ...f, incidents: [...incidents, inc].slice(-MAX_INCIDENTS) };
  }
  return { file: f, created, reopened, rejected };
}

/**
 * Condition-based clearing. An open incident whose every system answered this round and no longer
 * reports any of its conditions is resolved, and only then marked verified. A system that didn't
 * answer proves nothing, so its incidents stay open.
 */
export function clearResolved(file: OpsFile, activeKeys: ReadonlySet<string>, observed: ReadonlySet<EventSystem>, now: number): { file: OpsFile; cleared: Incident[] } {
  const cleared: Incident[] = [];
  const at = new Date(now).toISOString();
  const incidents = file.incidents.map((i) => {
    if (CLOSED.has(i.state) || activeKeys.has(i.key) || !i.systems.every((s) => observed.has(s))) return i;
    const done: Incident = { ...i, state: "resolved", resolvedAt: at, verified: true, resolution: "The source answered again and no longer reports the problem." };
    cleared.push(done);
    return done;
  });
  return { file: cleared.length ? { ...file, incidents } : file, cleared };
}

export const isOpen = (i: Pick<Incident, "state">) => !CLOSED.has(i.state);
export const bySeverity = (a: Incident, b: Incident) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || b.lastAt.localeCompare(a.lastAt);
