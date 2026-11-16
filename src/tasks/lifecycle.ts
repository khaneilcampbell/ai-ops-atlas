import type { Actor, ApprovalDecision, AttemptState, ExecutionAttempt, StoredTask, TaskEvent, TaskEventType, TaskStatus, WorkflowKind } from "./types";

// The task lifecycle: every status change in the Task Center goes through these pure functions.
// No model is involved; the rules are fixed and checked in one place. Each function returns a new
// task (never edits the one passed in) with an event appended, or a reason it refused.

export type Result = { ok: true; task: StoredTask } | { ok: false; error: string };

/** Allowed status changes. Completed and cancelled are final; failed only leaves through Retry. */
export const TRANSITIONS: Record<TaskStatus, readonly TaskStatus[]> = {
  queued: ["running", "blocked", "awaiting_approval", "cancelled"],
  blocked: ["queued", "cancelled"],
  awaiting_approval: ["queued", "cancelled"],
  running: ["completed", "failed", "cancelled"],
  failed: ["queued"],
  completed: [],
  cancelled: [],
};

export const TERMINAL: ReadonlySet<TaskStatus> = new Set(["completed", "cancelled"]);
/** Statuses that still need something to happen. */
export const OPEN: ReadonlySet<TaskStatus> = new Set(["queued", "running", "blocked", "awaiting_approval"]);

export const MAX_EVENTS_PER_TASK = 200;
export const DEFAULT_MAX_ATTEMPTS = 3;
/** Attempt states that mean something may still be happening outside Atlas. */
const LIVE_ATTEMPT: ReadonlySet<AttemptState> = new Set(["requested", "running", "cancel_requested", "unknown"]);

export const canTransition = (from: TaskStatus, to: TaskStatus) => TRANSITIONS[from].includes(to);

export function newId(prefix: string): string {
  const c = globalThis.crypto;
  const rand = c?.randomUUID ? c.randomUUID().replace(/-/g, "").slice(0, 12) : Math.random().toString(36).slice(2, 14);
  return `${prefix}_${Date.now().toString(36)}${rand}`;
}

/** Appends an event, keeping history bounded: the oldest events go first, the "created" event is kept. */
export function withEvent(task: StoredTask, type: TaskEventType, actor: Actor, at: string, meta?: TaskEvent["meta"]): StoredTask {
  const event: TaskEvent = { id: newId("evt"), taskId: task.id, at, actor, type, ...(meta ? { meta } : {}) };
  let events = [...task.events, event];
  let trimmed = task.eventsTrimmed;
  while (events.length > MAX_EVENTS_PER_TASK) {
    const drop = events.findIndex((e) => e.type !== "created");
    events = events.filter((_, i) => i !== drop);
    trimmed++;
  }
  return { ...task, events, eventsTrimmed: trimmed, updatedAt: at };
}

/** A plain status change, checked against TRANSITIONS. */
export function transition(task: StoredTask, to: TaskStatus, actor: Actor, at: string, meta?: TaskEvent["meta"]): Result {
  if (task.status === to) return { ok: false, error: `The task is already ${to.replace("_", " ")}.` };
  if (!canTransition(task.status, to)) return { ok: false, error: `A ${task.status.replace("_", " ")} task can't move to ${to.replace("_", " ")}.` };
  const next: StoredTask = { ...task, status: to };
  if (to === "running" && !next.startedAt) next.startedAt = at;
  if (to === "completed" || to === "cancelled" || to === "failed") next.completedAt = at;
  if (to === "queued") delete next.completedAt;
  return { ok: true, task: withEvent(next, "status_changed", actor, at, { from: task.status, to, ...meta }) };
}

export const needsApproval = (t: Pick<StoredTask, "requiresApproval" | "categories">) => t.requiresApproval || t.categories.length > 0;
const nextAttemptNumber = (t: StoredTask) => t.attempts.length + 1;

/** The latest decision for the next attempt. Approval covers one run only. */
export function approvalFor(t: StoredTask, attempt = nextAttemptNumber(t)): ApprovalDecision | null {
  const r = t.approvals.filter((a) => a.forAttempt === attempt);
  return r.length ? r[r.length - 1].decision : null;
}

export const liveAttempt = (t: StoredTask): ExecutionAttempt | undefined => t.attempts.find((a) => LIVE_ATTEMPT.has(a.state));

/** Why a task can't start yet, or null when it can. Checked again at the moment of starting. */
export function startProblem(t: StoredTask, all: ReadonlyMap<string, StoredTask>, agentProblem: string | null): string | null {
  if (t.status !== "queued") return `Only a queued task can start; this one is ${t.status.replace("_", " ")}.`;
  if (liveAttempt(t)) return "An earlier run of this task hasn't finished, so another can't start.";
  if (t.attempts.length >= t.maxAttempts) return `This task has used all ${t.maxAttempts} attempts.`;
  const waiting = unmetDependencies(t, all);
  if (waiting.length) return `Waiting on ${waiting.length === 1 ? "a task" : `${waiting.length} tasks`} that ${waiting.length === 1 ? "isn't" : "aren't"} completed.`;
  if (needsApproval(t) && approvalFor(t) !== "granted") return "This task needs Khaneil's approval before it runs.";
  if (agentProblem) return agentProblem;
  return null;
}

export function unmetDependencies(t: Pick<StoredTask, "dependencyIds">, all: ReadonlyMap<string, StoredTask>): string[] {
  return t.dependencyIds.filter((id) => all.get(id)?.status !== "completed");
}

/** True when adding these dependencies would make a loop back to the task. */
export function wouldCycle(taskId: string, deps: readonly string[], all: ReadonlyMap<string, Pick<StoredTask, "dependencyIds">>): boolean {
  const seen = new Set<string>();
  const stack = [...deps];
  while (stack.length) {
    const id = stack.pop()!;
    if (id === taskId) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    stack.push(...(all.get(id)?.dependencyIds ?? []));
  }
  return false;
}

/** Queued task with unfinished dependencies: park it as blocked and say so. */
export function block(t: StoredTask, all: ReadonlyMap<string, StoredTask>, actor: Actor, at: string): Result {
  const waiting = unmetDependencies(t, all);
  if (!waiting.length) return { ok: false, error: "Nothing to wait for." };
  const r = transition(t, "blocked", actor, at);
  return r.ok ? { ok: true, task: withEvent(r.task, "dependency_blocked", actor, at, { waitingOn: waiting.join(",") }) } : r;
}

/** Blocked task whose dependencies have all completed goes back to the queue. */
export function unblock(t: StoredTask, all: ReadonlyMap<string, StoredTask>, actor: Actor, at: string): Result {
  if (t.status !== "blocked") return { ok: false, error: "The task isn't blocked." };
  if (unmetDependencies(t, all).length) return { ok: false, error: "Its dependencies haven't all completed." };
  return transition(t, "queued", actor, at, { reason: "dependencies completed" });
}

/** Asks for approval for the next attempt. */
export function requestApproval(t: StoredTask, actor: Actor, at: string): Result {
  if (!needsApproval(t)) return { ok: false, error: "This task doesn't need approval." };
  if (approvalFor(t) === "granted") return { ok: false, error: "The next run is already approved." };
  const r = transition(t, "awaiting_approval", actor, at);
  if (!r.ok) return r;
  const forAttempt = nextAttemptNumber(t);
  const task = { ...r.task, approvals: [...r.task.approvals, { id: newId("apr"), decision: "requested" as const, at, actor, forAttempt }] };
  return { ok: true, task: withEvent(task, "approval_requested", actor, at, { forAttempt }) };
}

/**
 * Who may decide: a person only, and never the agent the task is assigned to or the agent that
 * created it. Atlas, workflows and agents can ask for approval but can't give it.
 */
export function approvalRefusal(t: Pick<StoredTask, "agentId" | "createdBy">, actor: Actor): string | null {
  if (actor.kind !== "person") return `${actor.name} can't approve: only a person can.`;
  if (t.agentId && actor.id === t.agentId) return "The assigned agent can't approve its own task.";
  if (t.createdBy.kind !== "person" && actor.id === t.createdBy.id) return "Whoever asked for the task can't approve it.";
  return null;
}

export function decideApproval(t: StoredTask, decision: "granted" | "rejected", actor: Actor, at: string, reason?: string): Result {
  if (t.status !== "awaiting_approval") return { ok: false, error: "The task isn't waiting for approval." };
  const refusal = approvalRefusal(t, actor);
  if (refusal) return { ok: false, error: refusal };
  const r = transition(t, decision === "granted" ? "queued" : "cancelled", actor, at, decision === "rejected" ? { reason: "approval rejected" } : undefined);
  if (!r.ok) return r;
  const forAttempt = nextAttemptNumber(t);
  const task = { ...r.task, approvals: [...r.task.approvals, { id: newId("apr"), decision, at, actor, forAttempt, ...(reason ? { reason } : {}) }] };
  return { ok: true, task: withEvent(task, decision === "granted" ? "approval_granted" : "approval_rejected", actor, at, { forAttempt, ...(reason ? { reason } : {}) }) };
}

/**
 * Starts a run: re-checks every rule, then records a new attempt with its idempotency key
 * (task id and attempt number) before anything is sent, so the same attempt can't go out twice.
 */
export function beginAttempt(t: StoredTask, all: ReadonlyMap<string, StoredTask>, executor: WorkflowKind, actor: Actor, at: string, agentProblem: string | null): Result {
  const problem = startProblem(t, all, agentProblem);
  if (problem) return { ok: false, error: problem };
  const number = nextAttemptNumber(t);
  const attempt: ExecutionAttempt = { id: newId("run"), number, idempotencyKey: `${t.id}:${number}`, state: executor === "manual" ? "running" : "requested", executor, requestedAt: at, requestedBy: actor, ...(executor === "manual" ? { startedAt: at } : {}) };
  const r = transition({ ...t, attempts: [...t.attempts, attempt] }, "running", actor, at);
  if (!r.ok) return r;
  return { ok: true, task: withEvent(r.task, "execution_started", actor, at, { attempt: number, executor, idempotencyKey: attempt.idempotencyKey }) };
}

export type AttemptUpdate =
  | { state: "running"; externalId?: string; externalUrl?: string; auditId?: string }
  | { state: "succeeded"; externalId?: string; externalUrl?: string; result?: unknown }
  | { state: "failed"; error: string; externalId?: string; externalUrl?: string }
  | { state: "cancelled"; externalId?: string; externalUrl?: string }
  | { state: "unknown"; error: string };

/** Records what the executing system reported for one attempt, moving the task when the run ends. */
export function updateAttempt(t: StoredTask, attemptId: string, u: AttemptUpdate, actor: Actor, at: string): Result {
  const a = t.attempts.find((x) => x.id === attemptId);
  if (!a) return { ok: false, error: "No such run on this task." };
  if (!LIVE_ATTEMPT.has(a.state)) return { ok: false, error: "That run already finished." };
  const patch: ExecutionAttempt = { ...a, state: u.state };
  if ("externalId" in u && u.externalId) patch.externalId = u.externalId;
  if ("externalUrl" in u && u.externalUrl) patch.externalUrl = u.externalUrl;
  if ("auditId" in u && u.auditId) patch.auditId = u.auditId;
  if (u.state === "running" && !patch.startedAt) patch.startedAt = at;
  if (u.state === "succeeded" || u.state === "failed" || u.state === "cancelled") patch.finishedAt = at;
  if (u.state === "failed" || u.state === "unknown") patch.error = u.error;
  let task: StoredTask = { ...t, attempts: t.attempts.map((x) => (x.id === attemptId ? patch : x)) };
  const meta = { attempt: a.number, ...(patch.externalId ? { externalId: patch.externalId } : {}) };
  if (u.state === "running") {
    return { ok: true, task: patch.externalId && patch.externalId !== a.externalId ? withEvent(task, "external_confirmed", actor, at, meta) : withEvent(task, "status_changed", actor, at, { ...meta, run: "running" }) };
  }
  if (u.state === "unknown") return { ok: true, task: withEvent(task, "execution_failed", actor, at, { ...meta, outcome: "unknown", error: u.error }) };
  const to: TaskStatus = u.state === "succeeded" ? "completed" : u.state === "failed" ? "failed" : "cancelled";
  if (u.state === "succeeded" && "result" in u && u.result !== undefined) task = { ...task, result: u.result };
  if (u.state === "failed") task = { ...task, error: u.error };
  if (u.state === "cancelled") task = { ...task, cancelRequestedAt: undefined };
  const r = transition(task, to, actor, at, meta);
  if (!r.ok) return r;
  const type: TaskEventType = u.state === "succeeded" ? "execution_completed" : u.state === "failed" ? "execution_failed" : "external_confirmed";
  return { ok: true, task: withEvent(r.task, type, actor, at, { ...meta, ...(u.state === "cancelled" ? { confirmed: "cancelled" } : {}), ...(u.state === "failed" ? { error: u.error } : {}) }) };
}

/** Failed task back to the queue, within its attempt limit. */
export function retry(t: StoredTask, actor: Actor, at: string): Result {
  if (t.status !== "failed") return { ok: false, error: "Only a failed task can be retried." };
  if (t.attempts.length >= t.maxAttempts) return { ok: false, error: `All ${t.maxAttempts} attempts are used.` };
  if (liveAttempt(t)) return { ok: false, error: "An earlier run is still unaccounted for." };
  const r = transition({ ...t, error: undefined }, "queued", actor, at, { reason: "retry" });
  return r.ok ? { ok: true, task: withEvent(r.task, "retry_requested", actor, at, { nextAttempt: t.attempts.length + 1 }) } : r;
}

/**
 * Cancels. A task not yet running, or manual work, is cancelled at once. A run in an outside
 * system is only marked as "stop requested"; it becomes cancelled when that system confirms.
 */
export function cancel(t: StoredTask, actor: Actor, at: string, reason?: string): Result {
  if (TERMINAL.has(t.status)) return { ok: false, error: "The task already finished." };
  const live = liveAttempt(t);
  if (t.status === "running" && live && live.executor !== "manual") {
    if (t.cancelRequestedAt) return { ok: false, error: "A stop is already requested." };
    const task = { ...t, cancelRequestedAt: at, attempts: t.attempts.map((x) => (x.id === live.id ? { ...x, state: "cancel_requested" as const } : x)) };
    return { ok: true, task: withEvent(task, "cancellation_requested", actor, at, { attempt: live.number, ...(reason ? { reason } : {}) }) };
  }
  if (t.status === "failed") return { ok: false, error: "A failed task stays failed; retry it or leave it." };
  const base = live ? { ...t, attempts: t.attempts.map((x) => (x.id === live.id ? { ...x, state: "cancelled" as const, finishedAt: at } : x)) } : t;
  return transition(base, "cancelled", actor, at, reason ? { reason } : undefined);
}
