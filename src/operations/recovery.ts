import type { AutonomyLevel } from "../executive/types";
import { backoffMs } from "../execution/policy";
import type { Actor } from "../tasks/types";
import { safeText } from "./events";
import { PLAYBOOKS, playbook, type AdapterId, type Playbook } from "./playbooks";
import { authorizeRecovery } from "./policy";
import { audit, bump, type OpsStore } from "./store";
import type { Incident, OpsFile, RecoveryAttempt } from "./types";

// Workflow self-healing, bounded. Every attempt is authorized first, recorded before it runs
// (so a crash mid-run leaves a trace, never a silent repeat), keyed so the same attempt is never
// run twice, and judged by what the source shows afterwards, not by the adapter's own claim.
// A timeout means "unknown", never "stopped": an unknown attempt is reconciled before any retry.

export type FailureClass = "transient" | "uncertain" | "auth" | "config" | "budget" | "permanent";

/** Fixed text rules over the recorded error. Unknown text is permanent: Atlas never guesses a retry is safe. */
export function classifyFailure(text: string): FailureClass {
  const s = text.toLowerCase();
  if (/may or may not|unclear|unknown|no clear answer|timed? ?out|timeout/.test(s)) return /timed? ?out|timeout/.test(s) && !/may or may not|unclear/.test(s) ? "transient" : "uncertain";
  if (/\b(401|403)\b|unauthori[sz]ed|forbidden|key doesn't match|invalid token|credential/.test(s)) return "auth";
  if (/not set up|not configured|isn't set up|missing secret|needs /.test(s)) return "config";
  if (/budget|cap reached|daily limit/.test(s)) return "budget";
  if (/\b(429|500|502|503|504)\b|rate limit|network|econn|fetch failed|temporar|unavailable|did not answer|stale|answering late/.test(s)) return "transient";
  return "permanent";
}

/** Only transient failures are retried automatically; an uncertain one is reconciled first. */
export function retryEligible(c: FailureClass): { ok: boolean; reason: string } {
  switch (c) {
    case "transient": return { ok: true, reason: "Looks transient." };
    case "uncertain": return { ok: false, reason: "The outcome is unknown: reconcile it before any retry." };
    case "auth": return { ok: false, reason: "A key or permission problem: Khaneil has to fix it." };
    case "config": return { ok: false, reason: "Something isn't set up: Khaneil has to configure it." };
    case "budget": return { ok: false, reason: "Its budget is used: Khaneil decides whether to raise it." };
    default: return { ok: false, reason: "Not a known transient failure: Atlas won't guess a retry is safe." };
  }
}

/** Which approved playbook fits an incident. Undefined when none does: Atlas then recommends a task, never improvises. */
export function pickPlaybook(i: Pick<Incident, "types" | "evidence">): Playbook | undefined {
  const github = i.evidence.some((e) => e.system === "integration" && e.resource === "github");
  if (github && i.types.includes("integration.failing")) return playbook("rebuild-local-cache");
  if (i.types.includes("integration.failing")) return playbook("recheck-integration");
  if (i.types.includes("workflow.failed")) {
    // Only when the failure text looks transient; a real workflow bug isn't fixed by re-reading.
    const text = i.evidence.map((e) => e.detail).join(" ");
    return classifyFailure(text) === "transient" ? playbook("recheck-integration") : undefined;
  }
  return PLAYBOOKS.find((p) => p.applies.some((t) => i.types.includes(t)) && p.id !== "recheck-integration" && p.id !== "rebuild-local-cache");
}

export type AdapterResult = { state: "ok" | "failed" | "unknown"; detail: string };

/** What each playbook may call. Injected, so tests use mocks and nothing real runs. */
export interface RecoveryAdapter {
  /** Why the tool can't be used here (not set up, no permission), or null. */
  problem(i: Incident): string | null;
  run(i: Incident, attempt: RecoveryAttempt): Promise<AdapterResult>;
  /** Asks the outside system about an attempt whose outcome is unknown. Read-only. */
  reconcile?(i: Incident, attempt: RecoveryAttempt): Promise<AdapterResult>;
}
export type Adapters = Record<AdapterId, RecoveryAdapter>;

export interface RecoveryDeps {
  store: OpsStore;
  adapters: Adapters;
  level: AutonomyLevel;
  now?: () => number;
}

let n = 0;
const attemptId = (t: number) => `rec_${t.toString(36)}_${(n++).toString(36)}`;
const actorOf = (a: Actor): RecoveryAttempt["actor"] => ({ kind: a.kind === "person" ? "person" : "system", name: a.name });

function withTimeout(p: Promise<AdapterResult>, ms: number): Promise<AdapterResult> {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve({ state: "unknown", detail: `No answer within ${Math.round(ms / 1000)} s. It may still be running; Atlas doesn't treat a timeout as stopped.` }), ms);
    p.then(
      (r) => {
        clearTimeout(t);
        resolve(r);
      },
      (e) => {
        clearTimeout(t);
        resolve({ state: "unknown", detail: `No clear answer: ${e instanceof Error ? e.message : String(e)}` });
      },
    );
  });
}

export type RunResult = { ok: true; attempt: RecoveryAttempt } | { ok: false; error: string };

/**
 * Runs one approved playbook for one incident, if authorized. The single path to any adapter.
 */
export async function executePlaybook(d: RecoveryDeps, incidentId: string, playbookId: string, actor: Actor): Promise<RunResult> {
  const now = d.now ?? Date.now;
  const f0 = d.store.snapshot();
  const inc = f0.incidents.find((i) => i.id === incidentId);
  if (!inc) return { ok: false, error: "No such incident." };
  const pb = playbook(playbookId);
  const adapter = pb ? d.adapters[pb.adapter] : undefined;
  const mine = f0.attempts.filter((a) => a.incidentId === inc.id);

  // An earlier attempt whose outcome is unknown is reconciled first. Never retried blind.
  const unknown = [...mine].reverse().find((a) => a.outcome === "unknown");
  if (unknown && adapter) {
    if (!adapter.reconcile) return refuse(d, inc, pb, actor, "An earlier attempt's outcome is unknown and this playbook can't check it. Khaneil records what happened.");
    const r = await withTimeout(adapter.reconcile(inc, unknown), pb!.timeoutMs);
    d.store.update((f) => audit({ ...f, attempts: f.attempts.map((a) => (a.id === unknown.id ? { ...a, outcome: r.state === "ok" ? "succeeded" : r.state === "failed" ? "failed" : "unknown", detail: safeText(`Reconciled: ${r.detail}`), finishedAt: new Date(now()).toISOString() } : a)) }, "Atlas", "attempt_reconciled", inc.key, r.state));
    if (r.state === "unknown") return refuse(d, inc, pb, actor, "Still unknown after asking the outside system. Khaneil records whether it ran.");
  }

  const decision = authorizeRecovery({ level: d.level, actor, playbook: pb, policy: pb ? f0.policies[pb.id] : undefined, incident: inc, stop: f0.stop, attempts: f0.attempts, toolProblem: adapter ? adapter.problem(inc) : "No adapter for this playbook.", now: now() });
  d.store.update((f) => bump(f, "policies_evaluated"));
  if (!decision.allowed) return refuse(d, inc, pb, actor, decision.reason);

  const number = mine.filter((a) => a.playbookId === pb!.id && a.outcome !== "refused").length + 1;
  const key = `${inc.id}:${pb!.id}:${number}`;
  const attempt: RecoveryAttempt = { id: attemptId(now()), incidentId: inc.id, playbookId: pb!.id, number, actor: actorOf(actor), idempotencyKey: key, correlationId: inc.key, outcome: "dispatched", startedAt: new Date(now()).toISOString(), detail: decision.note, modelUsd: 0 };
  // Claim the key before running. A key already recorded is never run again.
  let claimed = false;
  d.store.update((f) => {
    if (f.attempts.some((a) => a.idempotencyKey === key)) return null;
    claimed = true;
    const incidents = f.incidents.map((i) => (i.id === inc.id ? { ...i, state: "recovering" as const, playbookId: pb!.id, attemptIds: [...i.attemptIds, attempt.id] } : i));
    return bump(bump(audit({ ...f, attempts: [...f.attempts, attempt].slice(-300), incidents }, actor.name, "recovery_dispatched", inc.key, `${pb!.name} #${number}`), "actions_dispatched"), "recovery_attempts");
  });
  if (!claimed) return { ok: false, error: "That attempt was already started." };

  const r = await withTimeout(adapter!.run(inc, attempt), pb!.timeoutMs);
  const finishedAt = new Date(now()).toISOString();
  const done: RecoveryAttempt = {
    ...attempt,
    outcome: r.state === "ok" ? "succeeded" : r.state === "failed" ? "failed" : "unknown",
    finishedAt,
    detail: safeText(r.detail),
    // Success is only what the source shows next time it answers.
    ...(r.state === "ok" ? { verification: { state: "pending", detail: (pb!.verification[0] ?? "Checked on the next read") + "." } } : {}),
    ...(r.state === "failed" && retryEligible(classifyFailure(r.detail)).ok ? { nextRetryAt: new Date(now() + backoffMs(number)).toISOString() } : {}),
  };
  d.store.update((f) => {
    let next = { ...f, attempts: f.attempts.map((a) => (a.id === attempt.id ? done : a)) };
    if (done.outcome !== "succeeded") next = escalateIfDone(next, inc.id, pb!, now());
    return audit(next, actor.name, `recovery_${done.outcome}`, inc.key, done.detail);
  });
  return { ok: true, attempt: done };
}

function refuse(d: RecoveryDeps, inc: Incident, pb: Playbook | undefined, actor: Actor, reason: string): RunResult {
  d.store.update((f) => bump(audit(f, actor.name, actor.kind === "person" ? "recovery_refused" : actor.kind === "agent" ? "policy_refused_agent" : "recovery_held", inc.key, `${pb?.name ?? "Unknown playbook"}: ${reason}`), "actions_refused"));
  return { ok: false, error: reason };
}

/** After a failed or unknown attempt: escalate when no automatic attempt is left or the failure isn't retryable. */
function escalateIfDone(f: OpsFile, incidentId: string, pb: Playbook, now: number): OpsFile {
  const inc = f.incidents.find((i) => i.id === incidentId);
  if (!inc) return f;
  const tries = f.attempts.filter((a) => a.incidentId === incidentId && a.playbookId === pb.id && a.outcome !== "refused");
  const last = tries[tries.length - 1];
  const policy = f.policies[pb.id];
  const exhausted = tries.length >= Math.min(policy?.maxRetries ?? pb.retry.max, pb.retry.max);
  const notRetryable = last && !last.nextRetryAt;
  if (!exhausted && !notRetryable) return { ...f, incidents: f.incidents.map((i) => (i.id === incidentId ? { ...i, state: "open" } : i)) };
  const reason = exhausted ? `${pb.name} tried ${tries.length} times without a verified fix.` : `${pb.name} can't fix this on its own: ${last?.detail ?? "unknown"}`;
  return bump({ ...f, incidents: f.incidents.map((i) => (i.id === incidentId ? { ...i, state: "escalated", escalation: { at: new Date(now).toISOString(), reason: safeText(reason, 200) } } : i)) }, "escalations");
}

/**
 * Verification: an attempt that reported success is judged once its systems answer again after it
 * finished. Passed when the incident's condition is gone, failed when it's still there.
 */
export function judgeVerification(f: OpsFile, activeKeys: ReadonlySet<string>, observedAt: (system: Incident["systems"][number]) => number | null, now: number): OpsFile {
  let next = f;
  for (const a of f.attempts) {
    if (a.verification?.state !== "pending" || !a.finishedAt) continue;
    const inc = next.incidents.find((i) => i.id === a.incidentId);
    if (!inc) continue;
    const fresh = inc.systems.every((s) => (observedAt(s) ?? 0) > Date.parse(a.finishedAt!));
    if (!fresh) continue;
    const passed = !activeKeys.has(inc.key);
    const at = new Date(now).toISOString();
    const pb = playbook(a.playbookId)!;
    next = {
      ...next,
      attempts: next.attempts.map((x) => (x.id === a.id ? { ...x, verification: { state: passed ? "passed" : "failed", at, detail: passed ? "The source answered again and no longer reports the problem." : "The source answered again and still reports the problem." }, ...(passed ? {} : { nextRetryAt: new Date(now + backoffMs(a.number)).toISOString() }) } : x)),
      incidents: next.incidents.map((i) => (i.id === inc.id ? (passed ? { ...i, state: "resolved" as const, resolvedAt: at, verified: true, resolution: `Fixed by ${pb.name} and verified.` } : { ...i, state: "open" as const }) : i)),
    };
    next = bump(audit(next, "Atlas", passed ? "verification_passed" : "verification_failed", inc.key, pb.name), passed ? "verifications_passed" : "verifications_failed");
    if (!passed) next = escalateIfDone(next, inc.id, pb, now);
  }
  return next;
}
