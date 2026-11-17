import { useSyncExternalStore } from "react";
import { writeWithRoom } from "../lib/storage";
import type { Backend } from "../tasks/store";
import type { Actor } from "../tasks/types";
import { setLevelProblem } from "./autonomy";
import { AUTONOMY_LEVELS, DEFAULT_AUTONOMY, type AutonomyLevel, type ExecutiveFile, type ExecutiveGoal } from "./types";

// Executive goals live on this device next to the tasks and runs they point at (same storage, same
// scope), behind the shared Backend interface. Writes read the stored copy first and are
// compare-and-set on the goal's rev. Text that looks like a credential is redacted before saving.

const KEY = "atlas:executive";
const MAX_GOALS = 200;
const MAX_AUDIT = 300;

export const localExecutiveBackend: Backend = {
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

export const emptyExecutive = (): ExecutiveFile => ({ version: 1, rev: 0, autonomy: DEFAULT_AUTONOMY, goals: [], routineRuns: {}, audit: [] });

export function parseExecutive(raw: string | null): ExecutiveFile {
  if (!raw) return emptyExecutive();
  try {
    const f = JSON.parse(raw) as Partial<ExecutiveFile>;
    if (f.version !== 1) return emptyExecutive();
    return {
      version: 1,
      rev: typeof f.rev === "number" ? f.rev : 0,
      // An unknown stored level falls back to the default: stored data never raises autonomy.
      autonomy: AUTONOMY_LEVELS.includes(f.autonomy as AutonomyLevel) ? (f.autonomy as AutonomyLevel) : DEFAULT_AUTONOMY,
      goals: Array.isArray(f.goals) ? f.goals.filter((g) => g && typeof g.id === "string" && typeof g.rev === "number" && typeof g.objective === "string").map((g) => ({ ...g, autonomy: AUTONOMY_LEVELS.includes(g.autonomy) ? g.autonomy : DEFAULT_AUTONOMY, runIds: Array.isArray(g.runIds) ? g.runIds : [] })) : [],
      routineRuns: f.routineRuns && typeof f.routineRuns === "object" ? f.routineRuns : {},
      audit: Array.isArray(f.audit) ? f.audit.slice(-MAX_AUDIT) : [],
    };
  } catch {
    return emptyExecutive();
  }
}

const SECRET = /\b(sk-[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[abprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|Bearer\s+[A-Za-z0-9._~+/-]{16,}=*)/g;

/** Replaces anything that looks like a key or token with [redacted]. */
export const redact = (s: string) => s.replace(SECRET, "[redacted]");

function redactGoal(g: ExecutiveGoal): ExecutiveGoal {
  return { ...g, objective: redact(g.objective), successCriteria: g.successCriteria.map(redact), constraints: g.constraints.map(redact), ...(g.outcomeNote ? { outcomeNote: redact(g.outcomeNote) } : {}) };
}

export type SaveResult = { ok: true; goal: ExecutiveGoal } | { ok: false; error: string };

export class ExecutiveStore {
  private file: ExecutiveFile;
  private listeners = new Set<() => void>();
  constructor(private backend: Backend) {
    this.file = parseExecutive(backend.read());
    backend.watch?.(() => {
      this.file = parseExecutive(backend.read());
      this.emit();
    });
  }
  snapshot(): ExecutiveFile {
    return this.file;
  }
  private commit(next: ExecutiveFile): string | null {
    const out = { ...next, rev: next.rev + 1, audit: next.audit.slice(-MAX_AUDIT) };
    try {
      this.backend.write(JSON.stringify(out));
    } catch {
      return "Couldn't save: this device's storage is full or unavailable.";
    }
    this.file = out;
    this.emit();
    return null;
  }
  private log(f: ExecutiveFile, actor: Actor, action: string, goalId?: string, detail?: string): ExecutiveFile {
    return { ...f, audit: [...f.audit, { at: new Date().toISOString(), actor: actor.name, action, ...(goalId ? { goalId } : {}), ...(detail ? { detail: redact(detail).slice(0, 200) } : {}) }] };
  }
  add(goal: ExecutiveGoal, actor: Actor): SaveResult {
    if (actor.kind !== "person") return { ok: false, error: "Only Khaneil can add a goal." };
    const f = parseExecutive(this.backend.read());
    if (f.goals.some((g) => g.id === goal.id)) return { ok: false, error: "A goal with this id already exists." };
    if (f.goals.length >= MAX_GOALS) return { ok: false, error: `Atlas keeps at most ${MAX_GOALS} goals on this device. Close or cancel old ones first.` };
    const saved = { ...redactGoal(goal), rev: 1 };
    const err = this.commit(this.log({ ...f, goals: [...f.goals, saved] }, actor, "goal_created", goal.id));
    return err ? { ok: false, error: err } : { ok: true, goal: saved };
  }
  /** Compare-and-set: saves only if the stored goal is still at `expectedRev`. */
  put(goal: ExecutiveGoal, expectedRev: number, actor: Actor, action: string): SaveResult {
    const f = parseExecutive(this.backend.read());
    const i = f.goals.findIndex((g) => g.id === goal.id);
    if (i < 0) return { ok: false, error: "The goal no longer exists." };
    if (f.goals[i].rev !== expectedRev) return { ok: false, error: "The goal changed somewhere else first. Look again and retry." };
    const saved = { ...redactGoal(goal), rev: expectedRev + 1 };
    const goals = f.goals.slice();
    goals[i] = saved;
    const err = this.commit(this.log({ ...f, goals }, actor, action, goal.id));
    return err ? { ok: false, error: err } : { ok: true, goal: saved };
  }
  /** Owner autonomy level: Khaneil only. New goals start at this level. */
  setAutonomy(level: AutonomyLevel, actor: Actor): string | null {
    const bad = setLevelProblem(actor, level);
    if (bad) return bad;
    const f = parseExecutive(this.backend.read());
    return this.commit(this.log({ ...f, autonomy: level }, actor, "autonomy_set", undefined, `Level ${level}`));
  }
  subscribe(fn: () => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private emit() {
    this.listeners.forEach((l) => l());
  }
}

let shared: ExecutiveStore | null = null;
export function executiveStore(): ExecutiveStore {
  if (!shared) shared = new ExecutiveStore(localExecutiveBackend);
  return shared;
}

export function useExecutive(): ExecutiveFile {
  const s = executiveStore();
  return useSyncExternalStore(
    (fn) => s.subscribe(fn),
    () => s.snapshot(),
    () => s.snapshot(),
  );
}
