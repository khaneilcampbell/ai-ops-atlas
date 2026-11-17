import type { Catalog } from "../catalog/types";
import type { AutonomyLevel } from "../executive/types";
import type { ExecutiveGoal } from "../executive/types";
import type { NewTask } from "../tasks/store";
import { ATLAS, type Actor, type StoredTask, type TaskPriority } from "../tasks/types";
import { impactOf, type Derived } from "./derive";
import { clearResolved, ingest, isOpen } from "./incidents";
import { authorizeRecovery, incidentTaskProblem } from "./policy";
import { executePlaybook, judgeVerification, pickPlaybook, type Adapters } from "./recovery";
import { audit, bump, type OpsStore } from "./store";
import { SEVERITY_RANK, type EventSystem, type Incident } from "./types";

// One operations round: ingest the derived events, group them into incidents, clear what the
// sources show fixed, judge pending verifications, create incident tasks where the level allows,
// and run an approved playbook only when every rule agrees. It runs when Atlas's records change
// (and on a slow clock tick for timeouts). No timer polls an outside system, no model is called.

export interface RoundDeps {
  store: OpsStore;
  adapters: Adapters;
  level: AutonomyLevel;
  catalog: Catalog;
  goals: readonly ExecutiveGoal[];
  tasks: readonly StoredTask[];
  createTask: (input: NewTask, actor: Actor) => { ok: true; task: StoredTask } | { ok: false; error: string };
  notify?: (title: string, body: string) => void;
  /** When each system's data was last read, for verification. */
  observedAt: (s: EventSystem) => number | null;
  now: number;
}

export interface RoundSummary {
  created: number;
  reopened: number;
  cleared: number;
  tasksCreated: number;
  dispatched: number;
}

const PRIORITY: Record<Incident["severity"], TaskPriority> = { critical: "critical", high: "high", medium: "medium", low: "low", info: "low" };

/** Who carries an incident's task: Atlas Health Monitor for systems, Agent Operations Lead for agents, tasks and goals. */
export function ownerOf(i: Pick<Incident, "systems">): string {
  return i.systems.some((s) => s === "integration" || s === "github" || s === "n8n" || s === "cloudflare") && !i.systems.some((s) => s === "goal" || s === "agent") ? "atlas-health-monitor" : "agent-operations-lead";
}

export function incidentTaskInput(i: Incident, catalog: Catalog): NewTask {
  const owner = catalog.agents.find((a) => a.id === ownerOf(i));
  return {
    title: `Incident: ${i.title}`.slice(0, 160),
    description: [`Severity ${i.severity}. Seen ${i.count} time${i.count === 1 ? "" : "s"} since ${i.firstAt}.`, ...i.evidence.slice(0, 5).map((e) => `${e.system} (${e.identity}): ${e.detail}${e.url ? ` ${e.url}` : ""}`), ...(i.impact.length ? [`Affects: ${i.impact.join("; ")}`] : [])].join("\n"),
    priority: PRIORITY[i.severity],
    source: "system",
    ...(owner ? { agentId: owner.id, agentName: owner.registry?.title ?? owner.name, buildingId: owner.projectId } : {}),
    intakeKey: `incident:${i.id}`,
  };
}

/** Makes the Task Center task for an incident, once. */
export function createIncidentTask(d: Pick<RoundDeps, "store" | "level" | "catalog" | "createTask">, incidentId: string, actor: Actor): { ok: true; taskId: string } | { ok: false; error: string } {
  const f = d.store.snapshot();
  const i = f.incidents.find((x) => x.id === incidentId);
  if (!i) return { ok: false, error: "No such incident." };
  if (i.incidentTaskId) return { ok: true, taskId: i.incidentTaskId };
  const bad = incidentTaskProblem(d.level, actor, f.stop);
  if (bad) return { ok: false, error: bad };
  const r = d.createTask(incidentTaskInput(i, d.catalog), actor);
  if (!r.ok) return r;
  d.store.update((x) => bump(audit({ ...x, incidents: x.incidents.map((y) => (y.id === i.id ? { ...y, incidentTaskId: r.task.id, taskIds: [...new Set([...y.taskIds, r.task.id])] } : y)) }, actor.name, "incident_task_created", i.key, r.task.id), "tasks_created"));
  return { ok: true, taskId: r.task.id };
}

export async function runRound(d: RoundDeps, derived: Derived): Promise<RoundSummary> {
  const s: RoundSummary = { created: 0, reopened: 0, cleared: 0, tasksCreated: 0, dispatched: 0 };
  const fresh: Incident[] = [];
  const escalatedBefore = new Set(d.store.snapshot().incidents.filter((i) => i.state === "escalated").map((i) => i.id));
  d.store.update((f0) => {
    const r = ingest(f0, derived.events, d.now);
    let f = judgeVerification(r.file, derived.activeKeys, d.observedAt, d.now);
    const c = clearResolved(f, derived.activeKeys, derived.observed, d.now);
    f = c.file;
    s.created = r.created.length;
    s.reopened = r.reopened.length;
    s.cleared = c.cleared.length;
    fresh.push(...r.created, ...r.reopened);
    // Dependency impact, refreshed for open incidents.
    f = { ...f, incidents: f.incidents.map((i) => (isOpen(i) ? { ...i, ...impactOf(i, d.goals, d.tasks), goalIds: [...new Set([...i.goalIds, ...impactOf(i, d.goals, d.tasks).goalIds])] } : i)) };
    for (const i of r.created) f = audit(f, "Atlas", "incident_created", i.key, `${i.severity}: ${i.title}`);
    for (const i of c.cleared) f = audit(f, "Atlas", "incident_cleared", i.key, i.title);
    if (!r.created.length && !r.reopened.length && !c.cleared.length && f.events === f0.events && f.attempts === f0.attempts && f.counters.events_rejected === f0.counters.events_rejected) return null;
    return f;
  });

  // Owner notifications: new or returning high and critical incidents, and new escalations.
  const f = d.store.snapshot();
  for (const i of fresh) if (SEVERITY_RANK[i.severity] <= SEVERITY_RANK.high) d.notify?.(`Atlas incident · ${i.severity}`, i.title);
  for (const i of f.incidents) if (i.state === "escalated" && !escalatedBefore.has(i.id)) d.notify?.("Atlas needs you", `${i.title}: ${i.escalation?.reason ?? "recovery stopped"}`);

  for (const i of f.incidents.filter(isOpen)) {
    // Incident tasks: high and critical, only where the level lets Atlas create them.
    if (!i.incidentTaskId && SEVERITY_RANK[i.severity] <= SEVERITY_RANK.high && !incidentTaskProblem(d.level, ATLAS, f.stop)) {
      if (createIncidentTask(d, i.id, ATLAS).ok) s.tasksCreated++;
    }
    // Autonomous recovery: checked silently first, so a held incident doesn't flood the audit.
    if (i.state !== "open") continue;
    const pb = pickPlaybook(i);
    if (!pb) continue;
    const cur = d.store.snapshot();
    const ok = authorizeRecovery({ level: d.level, actor: ATLAS, playbook: pb, policy: cur.policies[pb.id], incident: i, stop: cur.stop, attempts: cur.attempts, toolProblem: d.adapters[pb.adapter].problem(i), now: d.now });
    if (!ok.allowed) continue;
    const r = await executePlaybook({ store: d.store, adapters: d.adapters, level: d.level, now: () => d.now }, i.id, pb.id, ATLAS);
    if (r.ok) s.dispatched++;
  }
  return s;
}
