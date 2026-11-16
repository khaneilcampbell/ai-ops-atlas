import { useSyncExternalStore } from "react";
import type { Catalog } from "../catalog/types";
import { block, newId } from "../tasks/lifecycle";
import type { Backend } from "../tasks/store";
import type { TaskService } from "../tasks/store";
import { ATLAS, type Actor } from "../tasks/types";
import { resolveNode } from "./engine";
import { definitionProblems, topoOrder, upstream } from "./graph";
import type { Goal, WorkflowDefinition, WorkflowRun } from "./types";

// Live workflow runs. A run is only a list of pointers: node -> Task Center task, plus a frozen copy
// of the definition. Status, approvals and history stay in the Task Center, which also enforces
// dependencies and approvals. Kept on this device next to the tasks (same storage, same scope).

const KEY = "atlas:workflow-runs";

interface RunFile {
  version: 1;
  runs: WorkflowRun[];
}

export const localRunBackend: Backend = {
  read: () => {
    try {
      return localStorage.getItem(KEY);
    } catch {
      return null;
    }
  },
  write: (raw) => localStorage.setItem(KEY, raw),
  watch: (fn) => {
    const on = (e: StorageEvent) => e.key === KEY && fn();
    window.addEventListener("storage", on);
    return () => window.removeEventListener("storage", on);
  },
};

function parse(raw: string | null): WorkflowRun[] {
  if (!raw) return [];
  try {
    const f = JSON.parse(raw) as Partial<RunFile>;
    return f.version === 1 && Array.isArray(f.runs) ? f.runs.filter((r) => r && typeof r.id === "string" && r.snapshot && r.nodeTasks) : [];
  } catch {
    return [];
  }
}

export class RunStore {
  private runs: WorkflowRun[];
  private listeners = new Set<() => void>();
  constructor(private backend: Backend) {
    this.runs = parse(backend.read());
    backend.watch?.(() => {
      this.runs = parse(backend.read());
      this.emit();
    });
  }
  list(): readonly WorkflowRun[] {
    return this.runs;
  }
  /** Adds a run. Runs are never edited afterwards, so their snapshot stays the version they started on. */
  add(run: WorkflowRun): string | null {
    const next = [...parse(this.backend.read()), run];
    try {
      this.backend.write(JSON.stringify({ version: 1, runs: next } satisfies RunFile));
    } catch {
      return "Couldn't save the run: this device's storage is full or unavailable.";
    }
    this.runs = next;
    this.emit();
    return null;
  }
  subscribe(fn: () => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private emit() {
    this.listeners.forEach((l) => l());
  }
}

let shared: RunStore | null = null;
export function runStore(): RunStore {
  if (!shared) shared = new RunStore(localRunBackend);
  return shared;
}

export function useRuns(): readonly WorkflowRun[] {
  const s = runStore();
  return useSyncExternalStore(
    (fn) => s.subscribe(fn),
    () => s.list(),
    () => s.list(),
  );
}

const freeze = (d: WorkflowDefinition): WorkflowDefinition => JSON.parse(JSON.stringify(d)) as WorkflowDefinition;

/**
 * Starts a live run: one Task Center task per step, in dependency order, with the step's registry
 * agent, building, approval categories and upstream tasks as dependencies. Outcome nodes get no task.
 * Unconfigured steps get a manual task so the steps after them still wait for a person to record
 * the work; nothing is marked done. Nothing is executed: work starts from the Task Center as usual.
 */
export function startLiveRun(goal: Goal, def: WorkflowDefinition, svc: TaskService, store: RunStore, catalog: Catalog, actor: Actor, at = new Date().toISOString()): { run: WorkflowRun | null; error: string | null } {
  if (actor.kind !== "person") return { run: null, error: `${actor.name} can't start a workflow run: only a person can.` };
  const problems = definitionProblems(def);
  if (problems.length) return { run: null, error: `The workflow definition is invalid: ${problems[0]}` };
  const snapshot = freeze(def);
  const run: WorkflowRun = { id: newId("wfrun"), goalId: goal.id, definitionId: def.id, definitionVersion: def.version, snapshot, mode: "live", createdAt: at, createdBy: actor.name, nodeTasks: {}, errors: {} };
  for (const id of topoOrder(snapshot)!) {
    const n = snapshot.nodes.find((x) => x.id === id)!;
    if (n.kind === "outcome") continue;
    const r = resolveNode(n, catalog);
    const deps = upstream(snapshot, id).map((u) => run.nodeTasks[u]).filter(Boolean);
    const missingUpstream = upstream(snapshot, id).some((u) => snapshot.nodes.find((x) => x.id === u)?.kind !== "outcome" && !run.nodeTasks[u]);
    if (missingUpstream) {
      run.errors[id] = "Not created because an earlier step's task couldn't be made.";
      continue;
    }
    if (r.problem) {
      run.errors[id] = r.problem;
      continue;
    }
    const workflow = r.workflows[0];
    const res = svc.create(
      {
        title: n.unconfigured ? `${n.title} (unconfigured, do by hand)` : n.title,
        description: [n.summary, n.unconfigured ?? "", `Workflow Intelligence: ${def.name} v${def.version}, run ${run.id}.`].filter(Boolean).join("\n"),
        objective: goal.objective,
        priority: n.approval ? "high" : "medium",
        source: "system",
        ...(r.agent ? { agentId: r.agent.id, agentName: r.agentName } : {}),
        ...(r.buildingId ? { buildingId: r.buildingId, buildingName: r.buildingName } : {}),
        ...(workflow && n.execution.kind !== "manual" && n.execution.kind !== "none" ? { workflow } : {}),
        dependencyIds: deps,
        requiresApproval: !!n.approval,
        categories: n.approval?.categories ?? [],
        intakeKey: `workflow:${run.id}:${id}`,
      },
      actor,
    );
    if (!res.ok) {
      run.errors[id] = res.error;
      continue;
    }
    run.nodeTasks[id] = res.task.id;
    if (deps.length) svc.apply(res.task.id, (t, all, when) => block(t, all, ATLAS, when));
  }
  const saveError = store.add(run);
  return { run, error: saveError ?? (Object.keys(run.errors).length ? `${Object.keys(run.errors).length} step(s) have no task; see each step.` : null) };
}
