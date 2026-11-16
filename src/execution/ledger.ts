import { useSyncExternalStore } from "react";
import type { Backend } from "../tasks/store";
import type { RunLedger } from "./types";
import { writeWithRoom } from "../lib/storage";

// The execution ledger, one record per live run, kept on the same device storage as tasks and
// runs. Every write re-reads the stored copy and refuses a stale revision (compare-and-set), so
// two windows or an interrupted write can't overwrite each other. Survives restarts; a crash
// between "record dispatch" and "send" is recovered by Orchestrator.recover().

const KEY = "atlas:workflow-exec";
export const MAX_PROCESSED_EVENTS = 500;

interface LedgerFile {
  version: 1;
  runs: RunLedger[];
}

export const localLedgerBackend: Backend = {
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

function parse(raw: string | null): RunLedger[] {
  if (!raw) return [];
  try {
    const f = JSON.parse(raw) as Partial<LedgerFile>;
    return f.version === 1 && Array.isArray(f.runs) ? f.runs.filter((r) => r && typeof r.runId === "string" && typeof r.rev === "number") : [];
  } catch {
    return [];
  }
}

export const emptyLedger = (runId: string): RunLedger => ({ runId, rev: 0, handoffs: {}, validationFailures: [], processedEvents: [], dispatched: [], needsReconcile: {}, retryAfter: {} });

export type LedgerResult = { ok: true; ledger: RunLedger } | { ok: false; error: string };

export class LedgerStore {
  private runs: RunLedger[];
  private listeners = new Set<() => void>();
  constructor(private backend: Backend) {
    this.runs = parse(backend.read());
    backend.watch?.(() => {
      this.runs = parse(backend.read());
      this.emit();
    });
  }
  list(): readonly RunLedger[] {
    return this.runs;
  }
  /** The stored ledger for a run, read fresh from storage (or an empty one). */
  get(runId: string): RunLedger {
    return parse(this.backend.read()).find((r) => r.runId === runId) ?? this.runs.find((r) => r.runId === runId) ?? emptyLedger(runId);
  }
  /** Applies one change with compare-and-set on the run's revision. */
  update(runId: string, change: (l: RunLedger) => RunLedger | string): LedgerResult {
    const fresh = parse(this.backend.read());
    const i = fresh.findIndex((r) => r.runId === runId);
    const cur = i >= 0 ? fresh[i] : emptyLedger(runId);
    const next = change(structuredClone(cur));
    if (typeof next === "string") return { ok: false, error: next };
    if (next.rev !== cur.rev) return { ok: false, error: "The run's record changed somewhere else first." };
    const saved: RunLedger = { ...next, rev: cur.rev + 1, processedEvents: next.processedEvents.slice(-MAX_PROCESSED_EVENTS) };
    const out = fresh.slice();
    if (i >= 0) out[i] = saved;
    else out.push(saved);
    try {
      this.backend.write(JSON.stringify({ version: 1, runs: out } satisfies LedgerFile));
    } catch {
      return { ok: false, error: "Couldn't save the run's record: this device's storage is full or unavailable." };
    }
    this.runs = out;
    this.emit();
    return { ok: true, ledger: saved };
  }
  subscribe(fn: () => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private emit() {
    this.listeners.forEach((l) => l());
  }
}

let shared: LedgerStore | null = null;
export function ledgerStore(): LedgerStore {
  if (!shared) shared = new LedgerStore(localLedgerBackend);
  return shared;
}

export function useLedgers(): readonly RunLedger[] {
  const s = ledgerStore();
  return useSyncExternalStore(
    (fn) => s.subscribe(fn),
    () => s.list(),
    () => s.list(),
  );
}
