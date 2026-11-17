import type { Catalog } from "../catalog/types";
import { approvalFor, beginAttempt, block, cancel, liveAttempt, needsApproval, requestApproval, retry, TERMINAL, unmetDependencies, updateAttempt, withEvent, type AttemptUpdate, type Result } from "../tasks/lifecycle";
import { byId, type TaskService } from "../tasks/store";
import { ATLAS, type Actor, type ExecutionAttempt, type StoredTask, type WorkflowKind } from "../tasks/types";
import { resolveNode, skippedBy } from "../workflows/engine";
import { topoOrder } from "../workflows/graph";
import type { WorkflowNode, WorkflowRun } from "../workflows/types";
import { buildEnvelope, repairOutput, schemaFor, validateOutput } from "./handoff";
import type { LedgerStore } from "./ledger";
import { backoffMs, budgetProblem, MAX_CONCURRENT, MAX_REPAIRS, stepPolicy } from "./policy";
import type { BusinessOutcome, DispatchResult, ExecutionAdapter, HandoffEnvelope, ExecutionReport, ExternalStatus, HandoffRecord, RunLedger, StepOutput } from "./types";

// The execution orchestrator. It moves an authorised live workflow run forward with fixed rules
// and no model calls: release steps whose dependencies completed, ask for approvals, dispatch
// runnable steps to an adapter within a concurrency limit, accept verified reports for the live
// attempt only, validate outputs at the boundary, and retry or hold for review within bounds.
//
// It keeps no task state of its own. Status, attempts, idempotency keys and approvals live on the
// Task Center tasks (lifecycle.ts enforces them on every write); the ledger adds handoffs,
// processed report ids and dispatch keys. Both are durable, so a restart picks up where it was.

export interface OrchestratorDeps {
  tasks: TaskService;
  runs: { list(): readonly WorkflowRun[] };
  ledger: LedgerStore;
  catalog: Catalog;
  adapterFor(node: WorkflowNode, task: StoredTask): ExecutionAdapter;
  now?: () => string;
  maxConcurrent?: number;
  /**
   * Extra reason a step's agent can't take new work right now (the workspace turned it off or
   * limits its models), checked before every attempt on top of the registry. Optional.
   */
  agentGate?: (node: WorkflowNode) => string | null;
  /** Context for a step about to be sent (retrieved knowledge, tools, model route). Optional. */
  context?: (run: WorkflowRun, nodeId: string, task: StoredTask, attempt: number) => HandoffEnvelope["context"] | undefined;
  /** Phase 9 emergency stop: when it returns a reason, no new step is sent and no automatic retry is queued. */
  emergencyStop?: () => string | null;
}

export type Ok<T = object> = ({ ok: true } & T) | { ok: false; error: string };

export interface StepSummary {
  dispatched: string[];
  approvalsRequested: string[];
  approvalsCompleted: string[];
  retried: string[];
  /** Ready, but a person starts it (manual work, a decision, or a Touch ID run). */
  waitingOnPerson: { nodeId: string; why: string }[];
  /** Can't run from Atlas: what must be connected. */
  unconfigured: { nodeId: string; need: string }[];
  /** Over budget, waiting out a backoff, or held by the concurrency limit. */
  held: { nodeId: string; why: string }[];
  /** Runs past their timeout; checked with the outside system. */
  stale: string[];
}

const isPerson = (a: Actor) => a.kind === "person";
const executorOf = (a: ExecutionAdapter): WorkflowKind => (a.kind === "simulated" ? "n8n" : a.kind);
/** Adapters that may be retried automatically: nothing outside changes, or the outside system dedupes. */
const safeToRepeat = (a: ExecutionAdapter) => !a.sideEffects || a.idempotent;

export class Orchestrator {
  private now: () => string;
  private busy = new Set<string>();
  /** The round running now for each run, and the one queued to follow it (at most one). */
  private current = new Map<string, Promise<void>>();
  private followUp = new Map<string, Promise<Ok<{ summary: StepSummary }>>>();
  constructor(private d: OrchestratorDeps) {
    this.now = d.now ?? (() => new Date().toISOString());
  }

  private run(runId: string): WorkflowRun | undefined {
    return this.d.runs.list().find((r) => r.id === runId);
  }
  private node(run: WorkflowRun, nodeId: string): WorkflowNode | undefined {
    return run.snapshot.nodes.find((n) => n.id === nodeId);
  }
  private taskOf(run: WorkflowRun, nodeId: string): StoredTask | undefined {
    const id = run.nodeTasks[nodeId];
    return id ? this.d.tasks.repo.get(id) : undefined;
  }
  private agentProblem(node: WorkflowNode): string | null {
    return resolveNode(node, this.d.catalog).problem ?? this.d.agentGate?.(node) ?? null;
  }
  private ledgerOf(runId: string): RunLedger {
    return this.d.ledger.get(runId);
  }
  private nodeOfTask(run: WorkflowRun, taskId: string): string | undefined {
    return Object.entries(run.nodeTasks).find(([, t]) => t === taskId)?.[0];
  }

  /** A person authorises the run to execute. Agents, workflows and Atlas can't start a run. */
  authorize(runId: string, actor: Actor): Ok {
    if (!isPerson(actor)) return { ok: false, error: `${actor.name} can't start a workflow run: only a person can.` };
    const run = this.run(runId);
    if (!run) return { ok: false, error: "No such run." };
    const r = this.d.ledger.update(runId, (l) => (l.startedBy ? l : { ...l, startedBy: actor.name, startedAt: this.now() }));
    return r.ok ? { ok: true } : r;
  }

  /** Completes a manual attempt in one write: start (rules re-checked) and finish. */
  private completeManually(taskId: string, actor: Actor, agentProblem: string | null, result: unknown): Result {
    return this.d.tasks.apply(taskId, (t, all, at) => {
      const begun = t.status === "running" && liveAttempt(t)?.executor === "manual" ? { ok: true as const, task: t } : beginAttempt(t, all, "manual", actor, at, agentProblem);
      if (!begun.ok) return begun;
      return updateAttempt(begun.task, liveAttempt(begun.task)!.id, { state: "succeeded", result }, actor, at);
    });
  }

  private recordHandoff(runId: string, h: HandoffRecord): void {
    this.d.ledger.update(runId, (l) => ({ ...l, handoffs: { ...l.handoffs, [h.nodeId]: h } }));
  }

  /**
   * Moves the run forward one round. Safe to call on every Task Center change: each send is keyed
   * by the attempt's idempotency key and recorded before it goes out, and the task store refuses
   * stale writes, so overlapping calls can't send a step twice.
   */
  /**
   * Phase 9 recovery: only asks the outside systems about runs past their timeout and records
   * completions. Sends nothing, retries nothing, approves nothing.
   */
  async reconcile(runId: string): Promise<Ok<{ stale: string[] }>> {
    const run = this.run(runId);
    if (!run) return { ok: false, error: "No such run." };
    if (this.busy.has(runId)) return { ok: false, error: "A round is running for this workflow; try again shortly." };
    this.busy.add(runId);
    try {
      const summary: StepSummary = { dispatched: [], approvalsRequested: [], approvalsCompleted: [], retried: [], waitingOnPerson: [], unconfigured: [], held: [], stale: [] };
      this.syncCompletions(run);
      await this.checkStale(run, summary);
      return { ok: true, stale: summary.stale };
    } finally {
      this.busy.delete(runId);
    }
  }

  async step(runId: string): Promise<Ok<{ summary: StepSummary }>> {
    const run = this.run(runId);
    if (!run) return { ok: false, error: "No such run." };
    const ledger = this.ledgerOf(runId);
    if (!ledger.startedBy) return { ok: false, error: "A person hasn't started this run yet." };
    const summary: StepSummary = { dispatched: [], approvalsRequested: [], approvalsCompleted: [], retried: [], waitingOnPerson: [], unconfigured: [], held: [], stale: [] };
    if (ledger.cancelledAt) return { ok: true, summary };
    // A round is already going: wait for it, then run one more, so the caller gets a true summary
    // of the state after its change instead of an empty one (which read as "nothing waiting").
    if (this.busy.has(runId)) return this.afterCurrent(runId);
    this.busy.add(runId);
    let finished!: () => void;
    this.current.set(runId, new Promise<void>((r) => (finished = r)));
    try {
      this.d.tasks.reconcile();
      this.syncCompletions(run);
      await this.settleUncertain(run);
      await this.checkStale(run, summary);
      this.autoRetry(run, summary);
      this.d.tasks.reconcile();
      const toSend = this.plan(run, summary);
      await this.dispatchAll(run, toSend, summary);
      return { ok: true, summary };
    } finally {
      this.busy.delete(runId);
      this.current.delete(runId);
      finished();
    }
  }

  /** Overlapping callers share one follow-up round after the current one. */
  private afterCurrent(runId: string): Promise<Ok<{ summary: StepSummary }>> {
    let next = this.followUp.get(runId);
    if (!next) {
      next = (this.current.get(runId) ?? Promise.resolve()).then(() => {
        this.followUp.delete(runId);
        return this.step(runId);
      });
      this.followUp.set(runId, next);
    }
    return next;
  }

  /** Steps completed elsewhere (the Task Center, a GitHub run) get an "unverified" handoff, never an invented output. */
  private syncCompletions(run: WorkflowRun) {
    const l = this.ledgerOf(run.id);
    for (const [nodeId, taskId] of Object.entries(run.nodeTasks)) {
      const t = this.d.tasks.repo.get(taskId);
      if (t?.status !== "completed" || l.handoffs[nodeId]) continue;
      const a = t.attempts[t.attempts.length - 1];
      this.recordHandoff(run.id, { nodeId, taskId, attempt: a?.number ?? 0, at: t.completedAt ?? this.now(), state: "unverified", by: t.events[t.events.length - 1]?.actor.name ?? "unknown", reason: "Completed outside the orchestrator with no structured output." });
    }
  }

  private liveOutside(): number {
    let n = 0;
    for (const t of this.d.tasks.repo.list()) {
      const a = liveAttempt(t);
      if (a && a.executor !== "manual") n++;
    }
    return n;
  }

  private plan(run: WorkflowRun, s: StepSummary): { nodeId: string; adapter: ExecutionAdapter }[] {
    const order = topoOrder(run.snapshot) ?? [];
    const l = this.ledgerOf(run.id);
    let slots = (this.d.maxConcurrent ?? MAX_CONCURRENT) - this.liveOutside();
    const out: { nodeId: string; adapter: ExecutionAdapter }[] = [];
    for (const nodeId of order) {
      const node = this.node(run, nodeId)!;
      const t = this.taskOf(run, nodeId);
      if (!t || t.status !== "queued") continue;
      const all = byId(this.d.tasks.repo.list());
      if (unmetDependencies(t, all).length) {
        this.d.tasks.apply(t.id, (x, everyone, at) => block(x, everyone, ATLAS, at));
        continue;
      }
      if (needsApproval(t) && approvalFor(t) !== "granted") {
        const r = this.d.tasks.apply(t.id, (x, _a, at) => requestApproval(x, ATLAS, at));
        if (r.ok) s.approvalsRequested.push(nodeId);
        continue;
      }
      if (node.kind === "approval") {
        const grant = [...t.approvals].reverse().find((a) => a.decision === "granted");
        const r = this.completeManually(t.id, ATLAS, null, { approvedBy: grant?.actor.name });
        if (r.ok) {
          s.approvalsCompleted.push(nodeId);
          this.recordHandoff(run.id, { nodeId, taskId: t.id, attempt: r.task.attempts.length, at: this.now(), state: "validated", by: "Atlas", output: { schema: schemaFor(nodeId).id, fields: { approvedBy: grant?.actor.name ?? "unknown" }, artifacts: [] } });
        }
        continue;
      }
      if (node.kind === "decision") {
        s.waitingOnPerson.push({ nodeId, why: "Khaneil records this decision." });
        continue;
      }
      if (node.kind === "outcome") continue;
      if (node.unconfigured) {
        s.unconfigured.push({ nodeId, need: node.unconfigured });
        continue;
      }
      // A retired, removed or switched-off agent gets no new attempt. Said here, so the step shows
      // why it waits instead of being skipped without a word when the attempt is refused.
      const agentIssue = this.agentProblem(node);
      if (agentIssue) {
        s.held.push({ nodeId, why: agentIssue });
        continue;
      }
      if (this.reuse(run, node, t)) continue;
      const adapter = this.d.adapterFor(node, t);
      const avail = adapter.available(nodeId, node.agentId);
      if (!avail.ok) {
        s.unconfigured.push({ nodeId, need: node.unconfigured ?? avail.need ?? "No execution integration." });
        continue;
      }
      if (adapter.personStarts) {
        s.waitingOnPerson.push({ nodeId, why: adapter.kind === "github" ? "Start it in the Task Center (Touch ID)." : "A person does this step and marks it done in the Task Center." });
        continue;
      }
      const stop = this.d.emergencyStop?.();
      if (stop) {
        s.held.push({ nodeId, why: stop });
        continue;
      }
      const policy = stepPolicy(node);
      const over = budgetProblem(t, policy);
      if (over) {
        s.held.push({ nodeId, why: over });
        continue;
      }
      if (l.needsReconcile[nodeId]) {
        s.held.push({ nodeId, why: l.needsReconcile[nodeId] });
        continue;
      }
      if (slots <= 0) {
        s.held.push({ nodeId, why: "Waiting for a free run slot (concurrency limit)." });
        continue;
      }
      slots--;
      out.push({ nodeId, adapter });
    }
    return out;
  }

  /** Reuses a validated output from an earlier run of the same step, inside the step's freshness window. */
  private reuse(run: WorkflowRun, node: WorkflowNode, t: StoredTask): boolean {
    const days = stepPolicy(node).reuseDays;
    if (!days) return false;
    const cutoff = Date.parse(this.now()) - days * 86_400_000;
    let best: { runId: string; h: HandoffRecord } | null = null;
    for (const other of this.d.ledger.list()) {
      if (other.runId === run.id) continue;
      const otherRun = this.run(other.runId);
      if (!otherRun || otherRun.definitionId !== run.definitionId) continue;
      const h = other.handoffs[node.id];
      if (h?.state === "validated" && h.output && Date.parse(h.at) >= cutoff && (!best || h.at > best.h.at)) best = { runId: other.runId, h };
    }
    if (!best) return false;
    const r = this.completeManually(t.id, ATLAS, this.agentProblem(node), { reusedFrom: best.runId, schema: best.h.output!.schema });
    if (!r.ok) return false;
    this.recordHandoff(run.id, { ...best.h, taskId: t.id, attempt: r.task.attempts.length, at: this.now(), by: "Atlas", reason: `Reused from run ${best.runId} (validated ${best.h.at.slice(0, 10)}).` });
    return true;
  }

  private async dispatchAll(run: WorkflowRun, items: { nodeId: string; adapter: ExecutionAdapter }[], s: StepSummary) {
    const sends: Promise<void>[] = [];
    for (const { nodeId, adapter } of items) {
      const node = this.node(run, nodeId)!;
      const t = this.taskOf(run, nodeId)!;
      const begun = this.d.tasks.apply(t.id, (x, all, at) => beginAttempt(x, all, executorOf(adapter), ATLAS, at, this.agentProblem(node)));
      if (!begun.ok) continue;
      const attempt = liveAttempt(begun.task)!;
      // Record the key before sending. A key already recorded is never sent again.
      const claimed = this.d.ledger.update(run.id, (l) => (l.dispatched.includes(attempt.idempotencyKey) ? "already sent" : { ...l, dispatched: [...l.dispatched, attempt.idempotencyKey] }));
      if (!claimed.ok) continue;
      const env = buildEnvelope(run.snapshot, run, nodeId, attempt, claimed.ledger.handoffs, this.now());
      // Context is best effort: a failure here never blocks or changes the send itself.
      if (this.d.context) {
        try {
          const c = this.d.context(run, nodeId, begun.task, attempt.number);
          if (c) env.context = c;
        } catch {
          /* sent without context */
        }
      }
      s.dispatched.push(nodeId);
      sends.push(
        adapter
          .dispatch(env)
          .catch((e): DispatchResult => ({ state: "unknown", error: `No clear answer: ${e instanceof Error ? e.message : String(e)}` }))
          .then((res) => this.applyDispatch(run, nodeId, t.id, attempt, res, adapter)),
      );
    }
    await Promise.all(sends);
  }

  private applyDispatch(run: WorkflowRun, nodeId: string, taskId: string, attempt: ExecutionAttempt, res: DispatchResult, adapter: ExecutionAdapter) {
    const actor: Actor = { kind: executorOf(adapter) as "n8n" | "github", id: adapter.kind, name: adapter.kind };
    let u: AttemptUpdate;
    if (res.state === "accepted") u = { state: "running", externalId: res.externalId, externalUrl: res.externalUrl };
    else if (res.state === "refused") u = { state: "failed", error: `Not sent: ${res.error ?? "refused"}` };
    else u = { state: "unknown", error: res.error ?? "The system's answer was unclear." };
    this.d.tasks.apply(taskId, (t, _a, at) => updateAttempt(t, attempt.id, u, actor, at));
    if (res.state === "unknown") this.d.ledger.update(run.id, (l) => ({ ...l, needsReconcile: { ...l.needsReconcile, [nodeId]: "The send may have gone out. Check the outside system, then record whether it ran." } }));
  }

  /**
   * Attempts Atlas isn't sure about (a restart mid-send, an unclear answer): ask the outside system
   * each round when it can answer. Settled ones go on; the rest stay with a person.
   */
  private async settleUncertain(run: WorkflowRun) {
    for (const [nodeId, taskId] of Object.entries(run.nodeTasks)) {
      const t = this.d.tasks.repo.get(taskId);
      const a = t && liveAttempt(t);
      if (!t || !a || a.state !== "unknown" || a.executor === "manual") continue;
      const node = this.node(run, nodeId)!;
      const adapter = this.d.adapterFor(node, t);
      if (!adapter.status) continue;
      const st = await adapter.status(a, { nodeId, agentId: node.agentId }).catch((): ExternalStatus => ({ state: "unknown" }));
      if (st.state === "not_found" || (st.state === "unknown" && !st.why)) continue;
      this.applyExternal(run, nodeId, t, a, st, adapter);
    }
  }

  private clearReconcile(runId: string, nodeId: string) {
    this.d.ledger.update(runId, (l) => (l.needsReconcile[nodeId] ? { ...l, needsReconcile: Object.fromEntries(Object.entries(l.needsReconcile).filter(([k]) => k !== nodeId)) } : "unchanged"));
  }

  private scheduleRetry(runId: string, nodeId: string, attemptNumber: number, task: StoredTask, adapter: ExecutionAdapter, immediately = false) {
    if (!safeToRepeat(adapter) || task.attempts.length >= task.maxAttempts) return;
    const when = new Date(Date.parse(this.now()) + (immediately ? 0 : backoffMs(attemptNumber))).toISOString();
    this.d.ledger.update(runId, (x) => ({ ...x, retryAfter: { ...x.retryAfter, [nodeId]: when } }));
  }

  /** Runs past their timeout: ask the outside system. Never assume a timed-out run failed or stopped. */
  private async checkStale(run: WorkflowRun, s: StepSummary) {
    const now = Date.parse(this.now());
    for (const [nodeId, taskId] of Object.entries(run.nodeTasks)) {
      const t = this.d.tasks.repo.get(taskId);
      const a = t && liveAttempt(t);
      if (!t || !a || a.executor === "manual") continue;
      const node = this.node(run, nodeId)!;
      if (now - Date.parse(a.startedAt ?? a.requestedAt) < stepPolicy(node).timeoutMs) continue;
      s.stale.push(nodeId);
      const adapter = this.d.adapterFor(node, t);
      // Already uncertain and asked this round by settleUncertain.
      if (a.state === "unknown" && adapter.status) continue;
      let st: ExternalStatus = { state: "unknown" };
      if (adapter.status) st = await adapter.status(a, { nodeId, agentId: node.agentId }).catch((): ExternalStatus => ({ state: "unknown" }));
      this.applyExternal(run, nodeId, t, a, st, adapter);
    }
  }

  private applyExternal(run: WorkflowRun, nodeId: string, t: StoredTask, a: ExecutionAttempt, st: ExternalStatus, adapter: ExecutionAdapter) {
    const actor: Actor = { kind: "system", id: "atlas-reconcile", name: "Atlas (reconciled)" };
    const processed = (eventId?: string) => eventId && this.d.ledger.update(run.id, (x) => (x.processedEvents.includes(eventId) ? "unchanged" : { ...x, processedEvents: [...x.processedEvents, eventId] }));
    if (st.state === "running") {
      if (a.state === "unknown") {
        const r = this.d.tasks.apply(t.id, (x, _all, at) => updateAttempt(x, a.id, { state: "running" }, actor, at));
        if (r.ok) this.clearReconcile(run.id, nodeId);
      }
      return;
    }
    if (st.state === "succeeded") {
      if (st.output) {
        // The output is validated like any report: an empty or invalid one fails the step, it never completes it.
        const r = this.acceptOutput(run, nodeId, t.id, a, st.output, actor, adapter);
        if (r.ok) {
          processed(st.eventId);
          this.clearReconcile(run.id, nodeId);
        }
        return;
      }
      const r = this.d.tasks.apply(t.id, (x, _all, at) => updateAttempt(x, a.id, { state: "succeeded" }, actor, at));
      if (r.ok) this.clearReconcile(run.id, nodeId);
      return;
    }
    if (st.state === "failed" || st.state === "not_sent") {
      const error = st.state === "not_sent" ? "The site has no record of this send, so it never reached n8n. Safe to send again." : st.error;
      const r = this.d.tasks.apply(t.id, (x, _all, at) => updateAttempt(x, a.id, { state: "failed", error }, actor, at));
      if (!r.ok) return;
      if (st.state === "failed") processed(st.eventId);
      this.clearReconcile(run.id, nodeId);
      if (st.state === "not_sent") this.scheduleRetry(run.id, nodeId, a.number, r.task, adapter, true);
      else if (st.transient) this.scheduleRetry(run.id, nodeId, a.number, r.task, adapter);
      return;
    }
    const why =
      st.state === "unknown" && st.why
        ? `${st.why} Then record whether it ran.`
        : st.state === "not_found"
          ? "Past its timeout and the outside system shows no run for it. Check there, then record whether it ran."
          : "Past its timeout and its status can't be read. Check the outside system, then record whether it ran.";
    if (a.state !== "unknown") this.d.tasks.apply(t.id, (x, _all, at) => updateAttempt(x, a.id, { state: "unknown", error: why }, actor, at));
    this.d.ledger.update(run.id, (l) => (l.needsReconcile[nodeId] === why ? "unchanged" : { ...l, needsReconcile: { ...l.needsReconcile, [nodeId]: why } }));
  }

  private autoRetry(run: WorkflowRun, s: StepSummary) {
    const stop = this.d.emergencyStop?.();
    const l = this.ledgerOf(run.id);
    if (stop) {
      for (const nodeId of Object.keys(l.retryAfter)) s.held.push({ nodeId, why: stop });
      return;
    }
    const now = this.now();
    for (const [nodeId, after] of Object.entries(l.retryAfter)) {
      const t = this.taskOf(run, nodeId);
      if (!t || t.status !== "failed") {
        this.d.ledger.update(run.id, (x) => ({ ...x, retryAfter: Object.fromEntries(Object.entries(x.retryAfter).filter(([k]) => k !== nodeId)) }));
        continue;
      }
      if (after > now) {
        s.held.push({ nodeId, why: `Retrying after ${after.slice(11, 16)} UTC (backoff).` });
        continue;
      }
      const r = this.d.tasks.apply(t.id, (x, _a, at) => retry(x, ATLAS, at));
      this.d.ledger.update(run.id, (x) => ({ ...x, retryAfter: Object.fromEntries(Object.entries(x.retryAfter).filter(([k]) => k !== nodeId)) }));
      if (r.ok) s.retried.push(nodeId);
    }
  }

  /**
   * Accepts a report from an executing system. Only for the step's live attempt, only from the
   * system that attempt went to, and each report id once. A replayed or forged report can't
   * complete a step, skip an approval or send anything.
   */
  receive(rep: ExecutionReport): Ok<{ duplicate?: boolean; validationErrors?: string[] }> {
    const run = this.run(rep.runId);
    if (!run) return { ok: false, error: "No such run." };
    const l = this.ledgerOf(rep.runId);
    if (!l.startedBy) return { ok: false, error: "The run hasn't been started by a person." };
    if (l.processedEvents.includes(rep.eventId)) return { ok: true, duplicate: true };
    const t = this.taskOf(run, rep.nodeId);
    if (!t) return { ok: false, error: "That step has no task in this run." };
    const a = t.attempts.find((x) => x.id === rep.attemptId);
    if (!a) return { ok: false, error: "No such attempt on this step." };
    if (rep.source.kind !== a.executor) return { ok: false, error: `Reports for this attempt must come from ${a.executor}, not ${rep.source.kind}.` };
    const live = liveAttempt(t);
    if (!live || live.id !== a.id) {
      // The task already recorded this attempt's end (e.g. a crash after the task write): finish the ledger side only.
      if (rep.kind === "succeeded" && a.state === "succeeded" && !l.handoffs[rep.nodeId] && rep.output && !validateOutput(rep.nodeId, rep.output).length) {
        this.d.ledger.update(rep.runId, (x) => ({ ...x, processedEvents: [...x.processedEvents, rep.eventId], handoffs: { ...x.handoffs, [rep.nodeId]: { nodeId: rep.nodeId, taskId: t.id, attempt: a.number, at: rep.at, state: "validated", output: rep.output!, by: rep.source.name } } }));
        return { ok: true, duplicate: true };
      }
      return { ok: false, error: "That attempt isn't running any more; the report is ignored." };
    }
    const node = this.node(run, rep.nodeId)!;
    const adapter = this.d.adapterFor(node, t);
    if (rep.usage) this.recordUsage(t.id, a.id, rep.usage, rep.source);
    let out: Ok<{ validationErrors?: string[] }> = { ok: true };
    if (rep.kind === "started") {
      const r = this.d.tasks.apply(t.id, (x, _a, at) => updateAttempt(x, a.id, { state: "running", externalId: rep.externalId, externalUrl: rep.externalUrl }, rep.source, at));
      if (!r.ok) return r;
    } else if (rep.kind === "succeeded") {
      out = this.acceptOutput(run, rep.nodeId, t.id, a, rep.output, rep.source, adapter);
      if (!out.ok) return out;
    } else {
      const r = this.d.tasks.apply(t.id, (x, _a, at) => updateAttempt(x, a.id, { state: "failed", error: rep.error ?? "Reported failed.", externalId: rep.externalId }, rep.source, at));
      if (!r.ok) return r;
      if (rep.transient) this.scheduleRetry(rep.runId, rep.nodeId, a.number, r.task, adapter);
    }
    // The system answered, so whatever made the attempt uncertain is settled.
    this.clearReconcile(rep.runId, rep.nodeId);
    this.d.ledger.update(rep.runId, (x) => ({ ...x, processedEvents: [...x.processedEvents, rep.eventId] }));
    return out;
  }

  /** Validates an output at the boundary; one deterministic repair; otherwise fail and retry or hold for review. */
  private acceptOutput(run: WorkflowRun, nodeId: string, taskId: string, a: ExecutionAttempt, raw: StepOutput | undefined, actor: Actor, adapter: ExecutionAdapter): Ok<{ validationErrors?: string[] }> {
    let errors = validateOutput(nodeId, raw);
    let output = raw;
    let repaired = false;
    if (errors.length) {
      const fixed = repairOutput(nodeId, raw);
      if (fixed && !validateOutput(nodeId, fixed).length) {
        output = fixed;
        errors = [];
        repaired = true;
      }
    }
    if (errors.length) {
      const at = this.now();
      const l = this.ledgerOf(run.id);
      const failures = l.validationFailures.filter((f) => f.nodeId === nodeId).length;
      this.d.ledger.update(run.id, (x) => ({ ...x, validationFailures: [...x.validationFailures, { nodeId, attempt: a.number, at, errors }] }));
      const r = this.d.tasks.apply(taskId, (x, _a, when) => updateAttempt(x, a.id, { state: "failed", error: `Output failed validation: ${errors.slice(0, 3).join(" ")}${failures >= MAX_REPAIRS || !safeToRepeat(adapter) ? " Needs review." : ""}` }, actor, when));
      if (!r.ok) return r;
      if (failures < MAX_REPAIRS && safeToRepeat(adapter) && r.task.attempts.length < r.task.maxAttempts) this.d.ledger.update(run.id, (x) => ({ ...x, retryAfter: { ...x.retryAfter, [nodeId]: at } }));
      return { ok: true, validationErrors: errors };
    }
    const result = { schema: output!.schema, artifacts: output!.artifacts.map((x) => x.url), ...(repaired ? { repaired: true } : {}) };
    const r = this.d.tasks.apply(taskId, (x, _a, at) => {
      const done = updateAttempt(x, a.id, { state: "succeeded", result }, actor, at);
      if (!done.ok) return done;
      const arts = output!.artifacts.map((art) => ({ id: art.id, label: art.label, url: art.url, kind: art.kind === "github_run" || art.kind === "pull_request" || art.kind === "n8n_execution" ? art.kind : ("link" as const), at }));
      return { ok: true, task: { ...done.task, artifacts: [...done.task.artifacts, ...arts] } };
    });
    if (!r.ok) return r;
    this.recordHandoff(run.id, { nodeId, taskId, attempt: a.number, at: this.now(), state: "validated", output: output!, by: actor.name, ...(repaired ? { reason: "Repaired deterministically (trimmed or retyped values)." } : {}) });
    return { ok: true };
  }

  private recordUsage(taskId: string, attemptId: string, u: NonNullable<ExecutionReport["usage"]>, actor: Actor) {
    this.d.tasks.apply(taskId, (t, _a, at) => ({ ok: true, task: withEvent({ ...t, usage: [...t.usage, { ...u, attemptId, recordedAt: at }] }, "edited", actor, at, { usage: u.model }) }));
  }

  private personStep(runId: string, nodeId: string, actor: Actor): Ok<{ run: WorkflowRun; node: WorkflowNode; task: StoredTask }> {
    if (!isPerson(actor)) return { ok: false, error: `${actor.name} can't do this: only a person can.` };
    const run = this.run(runId);
    if (!run) return { ok: false, error: "No such run." };
    if (!this.ledgerOf(runId).startedBy) return { ok: false, error: "Start the run first." };
    const node = this.node(run, nodeId);
    const task = this.taskOf(run, nodeId);
    if (!node || !task) return { ok: false, error: "That step has no task in this run." };
    return { ok: true, run, node, task };
  }

  /** Khaneil records a decision; the branch not taken is cancelled so nothing on it can run. */
  decide(runId: string, nodeId: string, branch: "yes" | "no", actor: Actor, reason?: string): Ok {
    const p = this.personStep(runId, nodeId, actor);
    if (!p.ok) return p;
    if (p.node.kind !== "decision") return { ok: false, error: "That step isn't a decision." };
    const r = this.completeManually(p.task.id, actor, null, { branch });
    if (!r.ok) return r;
    this.recordHandoff(runId, { nodeId, taskId: p.task.id, attempt: r.task.attempts.length, at: this.now(), state: "validated", by: actor.name, output: { schema: schemaFor(nodeId).id, fields: { branch, ...(reason ? { reason } : {}) }, artifacts: [] } });
    for (const skip of skippedBy(p.run.snapshot, { [nodeId]: branch })) {
      const t = this.taskOf(p.run, skip);
      if (t && !TERMINAL.has(t.status)) this.d.tasks.apply(t.id, (x, _a, at) => cancel(x, ATLAS, at, "branch not taken"));
    }
    return { ok: true };
  }

  /** A person waives a step (e.g. one research stream). Recorded as waived, never as an output. Not for approval-gated steps. */
  waive(runId: string, nodeId: string, reason: string, actor: Actor): Ok {
    const p = this.personStep(runId, nodeId, actor);
    if (!p.ok) return p;
    if (p.node.kind !== "agent" && p.node.kind !== "automation") return { ok: false, error: "Only agent or automation steps can be waived." };
    if (needsApproval(p.task)) return { ok: false, error: "A step that needs approval can't be waived." };
    if (!reason.trim()) return { ok: false, error: "Say why it's waived." };
    if (p.task.status === "failed") {
      const rr = this.d.tasks.apply(p.task.id, (x, _a, at) => retry(x, actor, at));
      if (!rr.ok) return rr;
    }
    const r = this.completeManually(p.task.id, actor, null, { waived: true, reason: reason.trim() });
    if (!r.ok) return r;
    this.recordHandoff(runId, { nodeId, taskId: p.task.id, attempt: r.task.attempts.length, at: this.now(), state: "waived", by: actor.name, reason: reason.trim() });
    return { ok: true };
  }

  /** A person records the output of a step they did by hand (manual or unconfigured). Validated like any other. */
  recordOutput(runId: string, nodeId: string, output: StepOutput, actor: Actor): Ok<{ validationErrors?: string[] }> {
    const p = this.personStep(runId, nodeId, actor);
    if (!p.ok) return p;
    if (p.node.kind === "approval" || p.node.kind === "decision") return { ok: false, error: "Approvals and decisions are recorded in their own way." };
    const live = liveAttempt(p.task);
    if (live && live.executor !== "manual") return { ok: false, error: "This step is running in an outside system; its report completes it." };
    const errors = validateOutput(nodeId, output);
    if (errors.length) return { ok: false, error: errors.join(" "), validationErrors: errors } as Ok<{ validationErrors?: string[] }>;
    const r = this.completeManually(p.task.id, actor, this.agentProblem(p.node), { schema: output.schema, artifacts: output.artifacts.map((a) => a.url) });
    if (!r.ok) return r;
    this.recordHandoff(runId, { nodeId, taskId: p.task.id, attempt: r.task.attempts.length, at: this.now(), state: "validated", output, by: actor.name });
    return { ok: true };
  }

  /** After a person checked the outside system: did the uncertain attempt run? */
  resolveUnknown(runId: string, nodeId: string, verdict: "succeeded" | "did_not_run" | "failed", actor: Actor): Ok {
    const p = this.personStep(runId, nodeId, actor);
    if (!p.ok) return p;
    const a = liveAttempt(p.task);
    if (!a) return { ok: false, error: "Nothing is waiting to be checked on this step." };
    const u: AttemptUpdate = verdict === "succeeded" ? { state: "succeeded" } : { state: "failed", error: verdict === "did_not_run" ? `Checked by ${actor.name}: it did not run.` : `Checked by ${actor.name}: it failed.` };
    const r = this.d.tasks.apply(p.task.id, (x, _a, at) => updateAttempt(x, a.id, u, actor, at));
    if (!r.ok) return r;
    this.d.ledger.update(runId, (l) => ({ ...l, needsReconcile: Object.fromEntries(Object.entries(l.needsReconcile).filter(([k]) => k !== nodeId)) }));
    return { ok: true };
  }

  /** Business result, separate from the workflow finishing. "achieved" needs at least one sourced metric. */
  recordOutcome(runId: string, o: Omit<BusinessOutcome, "recordedAt" | "recordedBy">, actor: Actor): Ok {
    const run = this.run(runId);
    if (!run) return { ok: false, error: "No such run." };
    const monitor = run.snapshot.nodes.find((n) => n.id === "monitor")?.agentId;
    if (!isPerson(actor) && !(actor.kind === "agent" && actor.id === monitor)) return { ok: false, error: `${actor.name} can't record the business outcome.` };
    if (o.state === "achieved" && !o.metrics.some((m) => m.source.trim() && Number.isFinite(m.value))) return { ok: false, error: "Saying the outcome was achieved needs at least one metric with its source." };
    const r = this.d.ledger.update(runId, (l) => ({ ...l, outcome: { ...o, recordedAt: this.now(), recordedBy: actor.name } }));
    return r.ok ? { ok: true } : r;
  }

  /** Cancels the run: open steps are cancelled; outside runs get a stop request and finish when confirmed. */
  cancelRun(runId: string, actor: Actor): Ok {
    if (!isPerson(actor)) return { ok: false, error: "Only a person can cancel a run." };
    const run = this.run(runId);
    if (!run) return { ok: false, error: "No such run." };
    for (const taskId of Object.values(run.nodeTasks)) {
      const t = this.d.tasks.repo.get(taskId);
      if (t && !TERMINAL.has(t.status) && t.status !== "failed") this.d.tasks.apply(taskId, (x, _a, at) => cancel(x, actor, at, "workflow run cancelled"));
    }
    const r = this.d.ledger.update(runId, (l) => ({ ...l, cancelledAt: this.now() }));
    return r.ok ? { ok: true } : r;
  }

  /**
   * After a restart: an attempt recorded but never confirmed either wasn't sent (its key isn't in
   * the ledger: failed, safe to retry) or may have been (key recorded: held as unknown until a
   * person checks). Nothing is re-sent automatically.
   */
  recover(): { notSent: string[]; uncertain: string[] } {
    const out = { notSent: [] as string[], uncertain: [] as string[] };
    for (const run of this.d.runs.list()) {
      const l = this.ledgerOf(run.id);
      if (!l.startedBy) continue;
      for (const taskId of Object.values(run.nodeTasks)) {
        const t = this.d.tasks.repo.get(taskId);
        const a = t && liveAttempt(t);
        if (!t || !a || a.state !== "requested" || a.executor === "manual" || this.busy.has(run.id)) continue;
        const nodeId = this.nodeOfTask(run, taskId)!;
        if (!l.dispatched.includes(a.idempotencyKey)) {
          this.d.tasks.apply(taskId, (x, _a, at) => updateAttempt(x, a.id, { state: "failed", error: "Atlas stopped before sending this run; it was never sent." }, ATLAS, at));
          out.notSent.push(nodeId);
        } else {
          const why = "Atlas stopped while sending this run, so it may or may not have gone out. Check the outside system, then record whether it ran.";
          this.d.tasks.apply(taskId, (x, _a, at) => updateAttempt(x, a.id, { state: "unknown", error: why }, ATLAS, at));
          this.d.ledger.update(run.id, (x) => ({ ...x, needsReconcile: { ...x.needsReconcile, [nodeId]: why } }));
          out.uncertain.push(nodeId);
        }
      }
    }
    return out;
  }
}
