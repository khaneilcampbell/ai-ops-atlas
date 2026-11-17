import type { Catalog } from "../catalog/types";
import type { StoredTask } from "../tasks/types";
import type { WorkflowRun } from "../workflows/types";
import { goalBudget, goalStatus } from "./coordinator";
import type { ExecutiveGoal } from "./types";

// Progress and blocker detection with fixed rules over records already on this device. No model
// calls and no timers: computed when the screen renders. Each signal has a stable key, so the same
// problem is one entry (and stays dismissed until it changes). A goal without a deadline is never
// called late.

export type SignalKind = "overdue" | "failed" | "missing_dependency" | "unavailable_agent" | "pending_approval" | "budget_exceeded" | "budget_warning" | "stale" | "unconfigured";

export interface ExecutiveSignal {
  key: string;
  goalId: string;
  kind: SignalKind;
  severity: "high" | "medium" | "low";
  title: string;
  detail: string;
  taskId?: string;
}

export const STALE_DAYS = 7;
const DAY = 86_400_000;
const OPEN: ReadonlySet<ExecutiveGoal["state"]> = new Set(["draft", "planned", "approved", "running", "review"]);

export function goalSignals(g: ExecutiveGoal, runs: readonly WorkflowRun[], tasks: ReadonlyMap<string, StoredTask>, catalog: Catalog, now: number): ExecutiveSignal[] {
  if (!OPEN.has(g.state)) return [];
  const out: ExecutiveSignal[] = [];
  const add = (kind: SignalKind, severity: ExecutiveSignal["severity"], title: string, detail: string, ref = "", taskId?: string) => out.push({ key: `exec:${g.id}:${kind}${ref ? `:${ref}` : ""}`, goalId: g.id, kind, severity, title, detail, ...(taskId ? { taskId } : {}) });

  if (g.deadline && now > Date.parse(`${g.deadline}T23:59:59`)) add("overdue", "high", "Past its deadline", `You set ${g.deadline}; the goal is still ${g.state.replace("_", " ")}.`, g.deadline);

  // Agents the plan relies on that can't take work now.
  for (const n of g.plan?.definition.nodes ?? []) {
    if (!n.agentId) continue;
    const a = catalog.agents.find((x) => x.id === n.agentId);
    if (!a || a.status === "retired" || a.status === "paused") add("unavailable_agent", "high", `${a?.registry?.title ?? a?.name ?? n.agentId} can't take work`, !a ? "It's no longer in the Agent Registry." : `It is ${a.status}. Its step won't run until it's back or the plan changes.`, n.agentId);
  }

  const s = goalStatus(g, runs, tasks, catalog);
  if (s.run) {
    for (const n of s.run.snapshot.nodes) {
      const st = s.status.get(n.id);
      const taskId = s.run.nodeTasks[n.id];
      const t = taskId ? tasks.get(taskId) : undefined;
      if (st === "failed") add("failed", "high", `${n.title} failed`, t?.error ? t.error.slice(0, 200) : "The task failed; open it to retry or cancel.", n.id, taskId);
      else if (st === "awaiting_approval") add("pending_approval", "medium", `${n.title} needs your approval`, (n.approval?.reason ?? "Approve or reject it in the Task Center."), n.id, taskId);
      else if (st === "no_task" || s.run.errors[n.id]) add("missing_dependency", "high", `${n.title} has no task`, s.run.errors[n.id] ?? "Its Task Center task is missing, so the steps after it can't run.", n.id);
      else if (st === "unconfigured" || (n.unconfigured && st !== "completed" && st !== "skipped")) add("unconfigured", "low", `${n.title} has no automation`, n.unconfigured ?? "A person has to do it and record it.", n.id, taskId);
    }
    if (g.state === "running") {
      const ids = Object.values(s.run.nodeTasks);
      const last = Math.max(Date.parse(s.run.createdAt), ...ids.map((id) => Date.parse(tasks.get(id)?.updatedAt ?? "") || 0));
      if (now - last > STALE_DAYS * DAY) add("stale", "medium", "No progress for a week", `Nothing on its tasks changed since ${new Date(last).toISOString().slice(0, 10)}.`, s.run.id);
    }
  }

  const b = goalBudget(g, [...tasks.values()], runs);
  if (b.exceeded) add("budget_exceeded", "high", "Budget used", `$${b.usedUsd.toFixed(2)} of $${b.limitUsd!.toFixed(2)} reported${b.estimated ? " (partly estimated)" : ""}. New steps won't start.`);
  else if (b.warning) add("budget_warning", "medium", "Budget almost used", `$${b.usedUsd.toFixed(2)} of $${b.limitUsd!.toFixed(2)} reported${b.estimated ? " (partly estimated)" : ""}.`);
  return out;
}

const RANK = { high: 0, medium: 1, low: 2 } as const;

/** Every open goal's signals, deduplicated by key, most severe first, minus dismissed ones. */
export function executiveAttention(goals: readonly ExecutiveGoal[], runs: readonly WorkflowRun[], tasks: ReadonlyMap<string, StoredTask>, catalog: Catalog, now: number, dismissed: ReadonlySet<string> = new Set()): ExecutiveSignal[] {
  const seen = new Map<string, ExecutiveSignal>();
  for (const g of goals) for (const s of goalSignals(g, runs, tasks, catalog, now)) if (!dismissed.has(s.key) && !seen.has(s.key)) seen.set(s.key, s);
  return [...seen.values()].sort((a, b) => RANK[a.severity] - RANK[b.severity] || a.key.localeCompare(b.key));
}
