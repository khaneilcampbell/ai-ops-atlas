import { useSyncExternalStore } from "react";
import { DEFAULT_MAX_ATTEMPTS, newId, unblock, withEvent, wouldCycle, type Result } from "./lifecycle";
import type { Actor, SensitiveCategory, StoredTask, TaskPriority, TaskSource, WorkflowRef } from "./types";
import { ATLAS } from "./types";
import { writeWithRoom } from "../lib/storage";

// Where tasks are kept. The first version keeps them on this device (the Mac app's or the
// browser's local storage), behind TaskRepository so a server-side store can replace it later
// without touching the screens. `scope` says honestly which one is in use: a device store is
// never shown as synced.

export interface TaskRepository {
  readonly scope: "device" | "synced";
  list(): readonly StoredTask[];
  get(id: string): StoredTask | undefined;
  /** Adds a new task. Refused when the id or the automated-intake key is already taken. */
  create(task: StoredTask): Result;
  /** Compare-and-set: saves only if the stored task is still at `expectedRev`. */
  put(task: StoredTask, expectedRev: number): Result;
  subscribe(fn: () => void): () => void;
}

export interface Backend {
  read(): string | null;
  write(raw: string): void;
  /** Calls back when another window changed the stored data. */
  watch?(fn: () => void): () => void;
}

interface TaskFile {
  version: 1;
  tasks: StoredTask[];
}

const KEY = "atlas:tasks";

export const localBackend: Backend = {
  read: () => {
    try {
      return localStorage.getItem(KEY);
    } catch {
      return null;
    }
  },
  write: (raw) => writeWithRoom(KEY, raw),
  watch: (fn) => {
    const on = (e: StorageEvent) => e.key === KEY && fn();
    window.addEventListener("storage", on);
    return () => window.removeEventListener("storage", on);
  },
};

export function memoryBackend(initial: string | null = null): Backend {
  let raw = initial;
  return { read: () => raw, write: (r) => void (raw = r) };
}

function parse(raw: string | null): StoredTask[] {
  if (!raw) return [];
  try {
    const f = JSON.parse(raw) as Partial<TaskFile>;
    return f.version === 1 && Array.isArray(f.tasks) ? f.tasks.filter((t) => t && typeof t.id === "string" && typeof t.rev === "number") : [];
  } catch {
    return [];
  }
}

/** A device-only store. Reads the stored copy again before every write so two windows can't overwrite each other. */
export class LocalTaskRepository implements TaskRepository {
  readonly scope = "device" as const;
  private tasks: StoredTask[];
  private listeners = new Set<() => void>();
  constructor(private backend: Backend) {
    this.tasks = parse(backend.read());
    backend.watch?.(() => {
      this.tasks = parse(backend.read());
      this.emit();
    });
  }
  list() {
    return this.tasks;
  }
  get(id: string) {
    return this.tasks.find((t) => t.id === id);
  }
  private commit(tasks: StoredTask[]): Result | null {
    try {
      this.backend.write(JSON.stringify({ version: 1, tasks } satisfies TaskFile));
    } catch {
      return { ok: false, error: "Couldn't save: this device's storage is full or unavailable." };
    }
    this.tasks = tasks;
    this.emit();
    return null;
  }
  create(task: StoredTask): Result {
    const fresh = parse(this.backend.read());
    if (fresh.some((t) => t.id === task.id)) return { ok: false, error: "A task with this id already exists." };
    if (task.intakeKey && fresh.some((t) => t.intakeKey === task.intakeKey)) return { ok: false, error: "This event already made a task." };
    return this.commit([...fresh, task]) ?? { ok: true, task };
  }
  put(task: StoredTask, expectedRev: number): Result {
    const fresh = parse(this.backend.read());
    const i = fresh.findIndex((t) => t.id === task.id);
    if (i < 0) return { ok: false, error: "The task no longer exists." };
    if (fresh[i].rev !== expectedRev) return { ok: false, error: "The task changed somewhere else first. Look again and retry." };
    const saved = { ...task, rev: expectedRev + 1 };
    const next = fresh.slice();
    next[i] = saved;
    return this.commit(next) ?? { ok: true, task: saved };
  }
  subscribe(fn: () => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private emit() {
    this.listeners.forEach((l) => l());
  }
}

export interface NewTask {
  title: string;
  description?: string;
  objective?: string;
  priority?: TaskPriority;
  source?: TaskSource;
  agentId?: string;
  agentName?: string;
  buildingId?: string;
  buildingName?: string;
  workflow?: WorkflowRef;
  dependencyIds?: string[];
  parentTaskId?: string;
  requiresApproval?: boolean;
  categories?: SensitiveCategory[];
  maxAttempts?: number;
  intakeKey?: string;
}

const workflowKey = (w?: WorkflowRef) => (w && w.kind !== "manual" ? `${w.kind}:${w.id}` : undefined);

/** Builds a valid new task (queued), with its "created" and "assigned" events. */
export function draftTask(input: NewTask, actor: Actor, at: string, all: ReadonlyMap<string, StoredTask>): Result {
  const title = input.title.trim();
  if (!title) return { ok: false, error: "Give the task a title." };
  if (title.length > 160) return { ok: false, error: "Keep the title under 160 characters." };
  const deps = [...new Set(input.dependencyIds ?? [])];
  const missing = deps.filter((d) => !all.has(d));
  if (missing.length) return { ok: false, error: "A dependency doesn't exist." };
  const id = newId("task");
  if (wouldCycle(id, deps, all)) return { ok: false, error: "Those dependencies would loop back to this task." };
  const maxAttempts = Math.min(10, Math.max(1, Math.round(input.maxAttempts ?? DEFAULT_MAX_ATTEMPTS)));
  let task: StoredTask = {
    id,
    title,
    description: (input.description ?? "").trim(),
    ...(input.objective?.trim() ? { objective: input.objective.trim() } : {}),
    status: "queued",
    priority: input.priority ?? "medium",
    ...(input.agentId ? { agentId: input.agentId, agentName: input.agentName ?? input.agentId } : {}),
    ...(input.buildingId ? { buildingId: input.buildingId, buildingName: input.buildingName ?? input.buildingId } : {}),
    ...(workflowKey(input.workflow) ? { workflowId: workflowKey(input.workflow), workflow: input.workflow } : input.workflow ? { workflow: input.workflow } : {}),
    source: input.source ?? "manual",
    ...(input.parentTaskId ? { parentTaskId: input.parentTaskId } : {}),
    dependencyIds: deps,
    requiresApproval: !!input.requiresApproval || (input.categories?.length ?? 0) > 0,
    categories: input.categories ?? [],
    maxAttempts,
    createdAt: at,
    updatedAt: at,
    createdBy: actor,
    rev: 0,
    attempts: [],
    approvals: [],
    artifacts: [],
    usage: [],
    events: [],
    eventsTrimmed: 0,
    ...(input.intakeKey ? { intakeKey: input.intakeKey } : {}),
  };
  task = withEvent(task, "created", actor, at, { source: task.source });
  if (task.agentId || task.buildingId) task = withEvent(task, "assigned", actor, at, { agent: task.agentId ?? null, building: task.buildingId ?? null });
  return { ok: true, task };
}

export const byId = (tasks: readonly StoredTask[]) => new Map(tasks.map((t) => [t.id, t]));

/** Task operations over a repository: read fresh, apply a lifecycle rule, save with compare-and-set. */
export class TaskService {
  constructor(readonly repo: TaskRepository, private now: () => string = () => new Date().toISOString()) {}
  create(input: NewTask, actor: Actor): Result {
    const d = draftTask(input, actor, this.now(), byId(this.repo.list()));
    return d.ok ? this.repo.create(d.task) : d;
  }
  /** Applies one change to one task. A stale copy is refused by the store, never merged silently. */
  apply(id: string, change: (t: StoredTask, all: ReadonlyMap<string, StoredTask>, at: string) => Result): Result {
    const all = byId(this.repo.list());
    const t = all.get(id);
    if (!t) return { ok: false, error: "No such task." };
    const r = change(t, all, this.now());
    if (!r.ok) return r;
    const saved = this.repo.put(r.task, t.rev);
    if (saved.ok) this.reconcile();
    return saved;
  }
  /** Releases blocked tasks whose dependencies have all completed. */
  reconcile() {
    for (let pass = 0; pass < 5; pass++) {
      const all = byId(this.repo.list());
      const ready = [...all.values()].filter((t) => t.status === "blocked" && unblock(t, all, ATLAS, this.now()).ok);
      if (!ready.length) return;
      for (const t of ready) {
        const r = unblock(t, all, ATLAS, this.now());
        if (r.ok) this.repo.put(r.task, t.rev);
      }
    }
  }
}

let shared: TaskService | null = null;
/** The app's task service, on this device's storage. */
export function taskService(): TaskService {
  if (!shared) shared = new TaskService(new LocalTaskRepository(localBackend));
  return shared;
}

export function useTasks(): readonly StoredTask[] {
  const repo = taskService().repo;
  return useSyncExternalStore(
    (fn) => repo.subscribe(fn),
    () => repo.list(),
    () => repo.list(),
  );
}

export type TaskEdit = Partial<Pick<NewTask, "title" | "description" | "objective" | "priority" | "agentId" | "agentName" | "buildingId" | "buildingName" | "workflow" | "dependencyIds" | "requiresApproval" | "categories" | "maxAttempts">>;

const EDITABLE = new Set(["queued", "blocked", "failed"]);

/**
 * Changes a task's details. Only before it runs or after it failed; never while it runs or once it
 * finished, so history stays true. A new agent must be able to take work (`agentProblem`).
 */
export function editTask(t: StoredTask, patch: TaskEdit, all: ReadonlyMap<string, StoredTask>, actor: Actor, at: string, agentProblem: string | null): Result {
  if (!EDITABLE.has(t.status)) return { ok: false, error: `A ${t.status.replace("_", " ")} task can't be edited.` };
  const next: StoredTask = { ...t };
  if (patch.title !== undefined) {
    const title = patch.title.trim();
    if (!title || title.length > 160) return { ok: false, error: "Give the task a title under 160 characters." };
    next.title = title;
  }
  if (patch.description !== undefined) next.description = patch.description.trim();
  if (patch.objective !== undefined) next.objective = patch.objective.trim() || undefined;
  if (patch.priority) next.priority = patch.priority;
  if (patch.dependencyIds) {
    const deps = [...new Set(patch.dependencyIds)];
    if (deps.includes(t.id) || deps.some((d) => !all.has(d))) return { ok: false, error: "A dependency doesn't exist." };
    if (wouldCycle(t.id, deps, all)) return { ok: false, error: "Those dependencies would loop back to this task." };
    next.dependencyIds = deps;
  }
  if (patch.categories) next.categories = patch.categories;
  if (patch.requiresApproval !== undefined || patch.categories) next.requiresApproval = !!(patch.requiresApproval ?? t.requiresApproval) || next.categories.length > 0;
  if (patch.maxAttempts !== undefined) next.maxAttempts = Math.min(10, Math.max(t.attempts.length || 1, Math.round(patch.maxAttempts)));
  if ("workflow" in patch) {
    next.workflow = patch.workflow;
    next.workflowId = workflowKey(patch.workflow);
  }
  const reassigned = ("agentId" in patch && patch.agentId !== t.agentId) || ("buildingId" in patch && patch.buildingId !== t.buildingId);
  if (reassigned) {
    if (patch.agentId && agentProblem) return { ok: false, error: agentProblem };
    if ("agentId" in patch) {
      next.agentId = patch.agentId || undefined;
      next.agentName = patch.agentId ? (patch.agentName ?? patch.agentId) : undefined;
    }
    if ("buildingId" in patch) {
      next.buildingId = patch.buildingId || undefined;
      next.buildingName = patch.buildingId ? (patch.buildingName ?? patch.buildingId) : undefined;
    }
  }
  let out = withEvent(next, "edited", actor, at);
  if (reassigned) out = withEvent(out, "assigned", actor, at, { agent: out.agentId ?? null, building: out.buildingId ?? null });
  return { ok: true, task: out };
}

/** Adds a link to something the task produced. Only https links are kept. */
export function addArtifact(t: StoredTask, label: string, url: string, actor: Actor, at: string): Result {
  let u: URL;
  try {
    u = new URL(url.trim());
  } catch {
    return { ok: false, error: "That isn't a link." };
  }
  if (u.protocol !== "https:") return { ok: false, error: "Only https links can be saved." };
  const kind = /github\.com\/.+\/actions\/runs\//.test(u.href) ? "github_run" : /github\.com\/.+\/pull\//.test(u.href) ? "pull_request" : /n8n/.test(u.hostname) ? "n8n_execution" : "link";
  const task = { ...t, artifacts: [...t.artifacts, { id: newId("art"), label: label.trim() || u.hostname, url: u.href, kind, at } as StoredTask["artifacts"][number]] };
  return { ok: true, task: withEvent(task, "edited", actor, at, { artifact: u.href }) };
}
