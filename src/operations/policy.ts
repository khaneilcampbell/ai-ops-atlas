import { authorizeAction, ROUTINES, type Decision } from "../executive/autonomy";
import type { AutonomyLevel } from "../executive/types";
import type { Actor } from "../tasks/types";
import { ALLOWED_SIDE_EFFECTS, PLAYBOOKS, type Playbook } from "./playbooks";
import type { Incident, OpsPolicy, OpsStop, RecoveryAttempt } from "./types";

// Policy-bounded autonomy for recovery. One gate, used before every adapter call: the emergency
// stop, the playbook registry, the owner's policy for it, the tool the adapter needs, and the
// Phase 8 autonomy rules (authorizeAction) all have to agree. A level never grants more than the
// playbook's own permissions, an agent can never change a policy, and a stored or external note
// can never raise anything.

export interface RecoveryContext {
  level: AutonomyLevel;
  actor: Actor;
  playbook: Playbook | undefined;
  policy: OpsPolicy | undefined;
  incident: Pick<Incident, "id" | "types" | "project" | "state">;
  stop: OpsStop | null;
  attempts: readonly RecoveryAttempt[];
  /** Whether the adapter's tool is set up and permitted on this device. */
  toolProblem: string | null;
  now: number;
}

const HOUR = 3_600_000;
const DAY = 86_400_000;

const refuse = (reason: string): Decision => ({ allowed: false, needsApproval: [], reason });

const autoAttempts = (attempts: readonly RecoveryAttempt[]) => attempts.filter((a) => a.actor.kind === "system" && a.outcome !== "refused");

/** May this actor run this playbook on this incident now? Pure, so the same answer everywhere. */
export function authorizeRecovery(c: RecoveryContext): Decision {
  const person = c.actor.kind === "person";
  if (c.stop?.active && !person) return refuse(`Emergency stop is on (${c.stop.reason || "no reason given"}). Only Khaneil can resume.`);
  const pb = c.playbook;
  if (!pb || !PLAYBOOKS.includes(pb)) return refuse("Not an approved recovery playbook.");
  if (!pb.applies.some((t) => c.incident.types.includes(t))) return refuse(`${pb.name} doesn't apply to this incident.`);
  if (!ALLOWED_SIDE_EFFECTS.includes(pb.sideEffect)) return refuse("This playbook changes something outside Atlas: it needs Khaneil's approval and isn't automatic.");
  if (c.toolProblem) return refuse(c.toolProblem);
  if (c.incident.state === "resolved" || c.incident.state === "dismissed") return refuse("The incident is closed.");
  const live = c.attempts.find((a) => a.incidentId === c.incident.id && a.outcome === "dispatched");
  if (live) return refuse("An attempt is still in progress.");

  if (person) return authorizeAction(c.level, { kind: "routine", resource: c.incident.id, environment: "atlas", risk: "low", categories: [], actor: c.actor, routineId: pb.routineId });

  // Atlas on its own: everything below must hold.
  const p = c.policy;
  if (!p || p.playbookId !== pb.id || !p.enabled) return refuse("Khaneil hasn't enabled this playbook's policy.");
  if (!p.projects.includes("*") && !(c.incident.project && p.projects.includes(c.incident.project))) return refuse("Outside the policy's project scope.");
  if (p.hours) {
    const h = new Date(c.now).getUTCHours();
    const inside = p.hours.from <= p.hours.to ? h >= p.hours.from && h < p.hours.to : h >= p.hours.from || h < p.hours.to;
    if (!inside) return refuse(`Outside the policy's hours (${p.hours.from}:00 to ${p.hours.to}:00 UTC).`);
  }
  const mine = autoAttempts(c.attempts).filter((a) => a.incidentId === c.incident.id && a.playbookId === pb.id);
  if (mine.length >= Math.min(p.maxRetries, pb.retry.max)) return refuse(`Used all ${Math.min(p.maxRetries, pb.retry.max)} automatic attempts. Escalated to Khaneil.`);
  const due = mine[mine.length - 1]?.nextRetryAt;
  if (due && Date.parse(due) > c.now) return refuse(`Waiting for backoff until ${due.slice(11, 16)} UTC.`);
  const lastHour = autoAttempts(c.attempts).filter((a) => a.playbookId === pb.id && c.now - Date.parse(a.startedAt) < HOUR).length;
  if (lastHour >= p.perHour) return refuse(`Rate limit: ${p.perHour} automatic runs an hour.`);
  // Model budget: every approved playbook is deterministic (modelUsd 0), so spend so far must stay within it.
  const spentToday = mine.filter((a) => c.now - Date.parse(a.startedAt) < DAY).reduce((s, a) => s + a.modelUsd, 0);
  if (spentToday > p.modelBudgetUsd) return refuse(`Model budget of $${p.modelBudgetUsd.toFixed(2)} a day is used.`);
  const today = autoAttempts(c.attempts).filter((a) => a.playbookId === pb.id && c.now - Date.parse(a.startedAt) < DAY).length;
  return authorizeAction(c.level, { kind: "routine", resource: c.incident.id, environment: "atlas", risk: "low", categories: [], actor: c.actor, routineId: pb.routineId, routineRunsToday: today });
}

/** Changing a policy: Khaneil only, and only within the playbook's own limits. */
export function policyProblem(actor: Actor, p: OpsPolicy): string | null {
  if (actor.kind !== "person") return `${actor.name} can't change autonomy policies: only Khaneil can.`;
  const pb = PLAYBOOKS.find((x) => x.id === p.playbookId);
  if (!pb) return "Not an approved recovery playbook.";
  if (!Number.isInteger(p.maxRetries) || p.maxRetries < 0 || p.maxRetries > pb.retry.max) return `Retries must be 0 to ${pb.retry.max} for this playbook.`;
  if (!Number.isInteger(p.perHour) || p.perHour < 0 || p.perHour > (ROUTINES[pb.routineId]?.perDay ?? 0)) return "Hourly limit is out of range.";
  if (!(p.modelBudgetUsd >= 0 && p.modelBudgetUsd <= 5)) return "Model budget must be $0 to $5 a day.";
  if (!Array.isArray(p.projects) || !p.projects.length) return "Name at least one project, or every project.";
  if (p.hours && !(p.hours.from >= 0 && p.hours.from < 24 && p.hours.to >= 0 && p.hours.to < 24)) return "Hours must be 0 to 23.";
  return null;
}

/** Making a Task Center task for an incident: Khaneil any time; Atlas only at level 2 or above and not during a stop. */
export function incidentTaskProblem(level: AutonomyLevel, actor: Actor, stop: OpsStop | null): string | null {
  if (actor.kind === "person") return null;
  if (stop?.active) return "Emergency stop is on.";
  if (level < 2) return "At level 0 and 1 Atlas recommends a task; Khaneil creates it.";
  return null;
}

/** Starting or lifting the emergency stop: Khaneil only. */
export function stopProblem(actor: Actor): string | null {
  return actor.kind === "person" ? null : `${actor.name} can't use the emergency stop: only Khaneil can.`;
}
