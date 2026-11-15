import type { Outcome } from "../actions/types";
import type { WorkflowRun as GithubRun } from "../github/types";
import { managedAgent } from "../manage/manifest";
import { N8N_READ_ONLY, githubRunUpdate, matchGithubRun, outcomeToUpdate, type ExecContext } from "../tasks/adapters";
import type { DispatchResult, ExecutionAdapter, ExternalStatus, HandoffEnvelope, StepOutput } from "./types";

// Execution adapters: the only way the orchestrator reaches an outside system. Each one says, from
// what is actually set up, whether it can run a step, whether running it has side effects, and
// whether a person must press start. Tokens never live here: GitHub writes go through the Mac
// app's Rust side (allow-list, macOS dialog, Touch ID, audit log); n8n is read-only.

/** n8n: Atlas holds only a read-only key on the site, so no n8n step can be started from Atlas. */
export const n8nAdapter: ExecutionAdapter = {
  kind: "n8n",
  sideEffects: true,
  idempotent: false,
  personStarts: false,
  available: () => ({ ok: false, need: `${N8N_READ_ONLY.reason} ${N8N_READ_ONLY.need}` }),
  dispatch: async () => ({ state: "refused", error: N8N_READ_ONLY.reason }),
};

/** A person does the work and records it. Never dispatched by the orchestrator. */
export const manualAdapter: ExecutionAdapter = {
  kind: "manual",
  sideEffects: false,
  idempotent: true,
  personStarts: true,
  available: () => ({ ok: true }),
  dispatch: async () => ({ state: "refused", error: "Manual work is recorded by a person in the Task Center." }),
};

export interface GithubDeps {
  ctx: ExecContext;
  /** The Mac app's run-now (Touch ID). Injected so tests never reach the real one. */
  runNow(agentId: string): Promise<Outcome>;
  /** Recent runs of the step's workflow, for reconciliation. */
  listRuns(agentId: string): Promise<readonly GithubRun[]>;
}

/**
 * GitHub: only agents on the Manage agents allow-list, only in the Mac app with its token. A
 * person presses start (Touch ID), so the orchestrator lists these as ready rather than sending them.
 */
export function githubAdapter(d: GithubDeps): ExecutionAdapter {
  const ok = (agentId?: string) => !!agentId && !!managedAgent(agentId);
  return {
    kind: "github",
    sideEffects: true,
    idempotent: false,
    personStarts: true,
    available: (_node, agentId) => {
      if (!ok(agentId)) return { ok: false, need: "Add the agent's workflow to the Manage agents allow-list (src/manage/agents.json, a high-risk change Khaneil approves)." };
      if (!d.ctx.desktop) return { ok: false, need: "Open Atlas on the Mac: GitHub runs start there with Touch ID." };
      if (!d.ctx.agentsToken) return { ok: false, need: "Save a Manage agents token in Settings → Actions → Manage agents." };
      return { ok: true };
    },
    dispatch: async (env: HandoffEnvelope): Promise<DispatchResult> => {
      if (!ok(env.destinationAgentId ?? undefined)) return { state: "refused", error: "Not on the allow-list." };
      const o = await d.runNow(env.destinationAgentId!);
      const u = outcomeToUpdate(o);
      if (u.state === "running") return { state: "accepted" };
      if (u.state === "unknown") return { state: "unknown", error: u.error };
      return { state: "refused", error: "error" in u ? u.error : "Not started." };
    },
    status: async (a, step): Promise<ExternalStatus> => {
      if (!ok(step.agentId)) return { state: "unknown" };
      try {
        return githubStatus(a, await d.listRuns(step.agentId!), new Set());
      } catch {
        return { state: "unknown" };
      }
    },
  };
}

/** Reconciles one attempt against GitHub's run list. Exposed for the adapter's owner and tests. */
export function githubStatus(a: { id: string; externalId?: string; requestedAt: string; idempotencyKey: string }, runs: readonly GithubRun[], claimed: ReadonlySet<string>): ExternalStatus {
  const attempt = { ...a, number: 0, state: "running" as const, executor: "github" as const, requestedBy: { kind: "system" as const, id: "atlas", name: "Atlas" } };
  const run = a.externalId ? runs.find((r) => String(r.id) === a.externalId) : matchGithubRun(attempt, runs, claimed);
  if (!run) return { state: "not_found" };
  const u = githubRunUpdate(attempt, run);
  if (!u || u.state === "running") return { state: "running" };
  if (u.state === "succeeded") return { state: "succeeded" };
  if (u.state === "failed") return { state: "failed", error: u.error };
  return { state: "failed", error: "The GitHub run was cancelled." };
}

export interface SimulatedPlan {
  /** What dispatch answers, per node (default accepted). */
  dispatch?: Record<string, DispatchResult["state"]>;
  /** What status() answers, per node. */
  status?: Record<string, ExternalStatus>;
  sideEffects?: boolean;
  idempotent?: boolean;
  unavailable?: Record<string, string>;
}

/** A stand-in for tests and demos. Makes no calls; records every envelope it receives. */
export function simulatedAdapter(plan: SimulatedPlan = {}): ExecutionAdapter & { sent: HandoffEnvelope[] } {
  const sent: HandoffEnvelope[] = [];
  return {
    kind: "simulated",
    sideEffects: plan.sideEffects ?? false,
    idempotent: plan.idempotent ?? true,
    personStarts: false,
    sent,
    available: (node) => (plan.unavailable?.[node] ? { ok: false, need: plan.unavailable[node] } : { ok: true }),
    dispatch: async (env) => {
      sent.push(env);
      const state = plan.dispatch?.[env.nodeId] ?? "accepted";
      return state === "accepted" ? { state, externalId: `sim-${env.idempotencyKey}` } : { state, error: `Simulated ${state}` };
    },
    status: async (a) => {
      const node = sent.find((e) => e.idempotencyKey === a.idempotencyKey)?.nodeId;
      return (node && plan.status?.[node]) || { state: "unknown" };
    },
  };
}

/**
 * The app's routing, fixed by the step's execution kind: n8n steps go to the read-only n8n adapter
 * (so they show as unconfigured), GitHub steps to the Touch ID path, everything else is manual.
 */
export function adapterRouter(github: ExecutionAdapter): (node: { execution: { kind: string } }) => ExecutionAdapter {
  return (node) => (node.execution.kind === "n8n" ? n8nAdapter : node.execution.kind === "github" ? github : manualAdapter);
}

/** A schema-valid output for tests. */
export const output = (schema: string, fields: StepOutput["fields"], artifacts: StepOutput["artifacts"] = []): StepOutput => ({ schema, fields, artifacts });
