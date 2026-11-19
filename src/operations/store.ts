import { useSyncExternalStore } from "react";
import { redact } from "../executive/store";
import { writeWithRoom } from "../lib/storage";
import type { Backend } from "../tasks/store";
import type { Actor } from "../tasks/types";
import { defaultPolicies, PLAYBOOKS } from "./playbooks";
import { policyProblem, stopProblem } from "./policy";
import { METRICS, type AuditEntry, type Metric, type OpsFile, type OpsPolicy, type OpsStop } from "./types";

// Operations state lives on this device next to the tasks, runs and goals it points at, behind
// the shared Backend interface. Every write reads the stored copy first (so two tabs don't
// overwrite each other) and appends to the audit trail. The audit trail is never paused, not even
// by the emergency stop.

const KEY = "atlas:operations";
export const MAX_AUDIT = 500;
export const MAX_ATTEMPTS = 300;

export const localOpsBackend: Backend = {
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

const zero = () => Object.fromEntries(METRICS.map((m) => [m, 0])) as Record<Metric, number>;
export const emptyOps = (): OpsFile => ({ version: 1, rev: 0, stop: null, policies: defaultPolicies(), events: [], incidents: [], attempts: [], audit: [], counters: zero() });

export function parseOps(raw: string | null): OpsFile {
  if (!raw) return emptyOps();
  try {
    const f = JSON.parse(raw) as Partial<OpsFile>;
    if (f.version !== 1) return emptyOps();
    const policies = defaultPolicies();
    // Stored policies are kept only for known playbooks and only when they pass the same checks a
    // change does; anything else falls back to the default (off). Stored data never widens autonomy.
    for (const p of Object.values(f.policies ?? {})) if (p && policies[p.playbookId] && !policyProblem({ kind: "person", id: "stored", name: "stored" }, p)) policies[p.playbookId] = { ...p, enabled: p.enabled === true };
    return {
      version: 1,
      rev: typeof f.rev === "number" ? f.rev : 0,
      stop: f.stop && typeof f.stop.active === "boolean" ? f.stop : null,
      policies,
      events: Array.isArray(f.events) ? f.events : [],
      incidents: Array.isArray(f.incidents) ? f.incidents.filter((i) => i && typeof i.id === "string" && typeof i.key === "string") : [],
      attempts: Array.isArray(f.attempts) ? f.attempts.slice(-MAX_ATTEMPTS) : [],
      audit: Array.isArray(f.audit) ? f.audit.slice(-MAX_AUDIT) : [],
      counters: { ...zero(), ...(f.counters ?? {}) },
    };
  } catch {
    return emptyOps();
  }
}

/** Appends one audit entry: ids and short redacted text only. */
export function audit(f: OpsFile, actor: string, action: string, correlationId?: string, detail?: string): OpsFile {
  const e: AuditEntry = { at: new Date().toISOString(), actor, action, ...(correlationId ? { correlationId } : {}), ...(detail ? { detail: redact(detail).slice(0, 200) } : {}) };
  return { ...f, audit: [...f.audit, e].slice(-MAX_AUDIT) };
}

export const bump = (f: OpsFile, m: Metric, n = 1): OpsFile => ({ ...f, counters: { ...f.counters, [m]: (f.counters[m] ?? 0) + n } });

export class OpsStore {
  private file: OpsFile;
  private listeners = new Set<() => void>();
  constructor(private backend: Backend) {
    this.file = parseOps(backend.read());
    backend.watch?.(() => {
      this.file = parseOps(backend.read());
      this.emit();
    });
  }
  snapshot(): OpsFile {
    return this.file;
  }
  /** Read fresh, change, save. Returns an error when the device can't save. */
  update(change: (f: OpsFile) => OpsFile | null): string | null {
    const f = parseOps(this.backend.read());
    const next = change(f);
    if (!next || next === f) return null;
    const out = { ...next, rev: f.rev + 1 };
    try {
      this.backend.write(JSON.stringify(out));
    } catch {
      return "Couldn't save: this device's storage is full or unavailable.";
    }
    this.file = out;
    this.emit();
    return null;
  }
  /** Emergency stop. Khaneil only. Audit and monitoring keep running. */
  setStop(actor: Actor, active: boolean, reason: string, site?: OpsStop["site"]): string | null {
    const bad = stopProblem(actor);
    if (bad) {
      this.update((f) => bump(audit(f, actor.name, "stop_refused", undefined, bad), "actions_refused"));
      return bad;
    }
    const at = new Date().toISOString();
    return this.update((f) => bump(audit({ ...f, stop: { active, at, by: actor.name, reason: redact(reason).slice(0, 200), ...(site ? { site } : {}) } }, actor.name, active ? "emergency_stop" : "resume", undefined, reason), active ? "stops" : "resumes"));
  }
  /** Records what the site said about holding n8n sends, without changing who stopped. */
  setSiteState(site: OpsStop["site"]) {
    this.update((f) => (f.stop ? { ...f, stop: { ...f.stop, site } } : null));
  }
  /** A policy change. Khaneil only; an agent's attempt is refused and recorded. */
  setPolicy(actor: Actor, p: OpsPolicy): string | null {
    const bad = policyProblem(actor, p);
    if (bad) {
      this.update((f) => bump(audit(f, actor.name, actor.kind === "person" ? "policy_invalid" : "policy_refused_agent", undefined, bad), "actions_refused"));
      return bad;
    }
    const pb = PLAYBOOKS.find((x) => x.id === p.playbookId)!;
    return this.update((f) => audit({ ...f, policies: { ...f.policies, [p.playbookId]: p } }, actor.name, p.enabled ? "policy_enabled" : "policy_disabled", undefined, pb.name));
  }
  subscribe(fn: () => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private emit() {
    this.listeners.forEach((l) => l());
  }
}

let shared: OpsStore | null = null;
export function opsStore(): OpsStore {
  if (!shared) shared = new OpsStore(localOpsBackend);
  return shared;
}

export function useOps(): OpsFile {
  const s = opsStore();
  return useSyncExternalStore(
    (fn) => s.subscribe(fn),
    () => s.snapshot(),
    () => s.snapshot(),
  );
}

/** The stop reason when autonomous dispatch is paused, else null. Read by the execution orchestrator. */
export function emergencyStopReason(): string | null {
  const s = opsStore().snapshot().stop;
  return s?.active ? `Emergency stop is on${s.reason ? ` (${s.reason})` : ""}. Khaneil resumes it in Mission Control.` : null;
}
