import type { Catalog } from "../catalog/types";
import { writeWithRoom } from "../lib/storage";
import { SENSITIVITIES, type Sensitivity } from "../registry/types";
import type { Backend } from "../tasks/store";
import type { Actor } from "../tasks/types";
import { DEFINITIONS } from "../workflows/benjaireLaunch";
import type { WorkflowDefinition } from "../workflows/types";
import { clean, injectionIn, isHttps, secretIn } from "./guard";
import { SEED_MEMORY } from "./knowledge";
import type { AuditEntry, IntelligenceFile, MemoryCategory, MemoryRecord, MemoryScope, SourceRef } from "./types";

// Persistent agent memory. Four categories with fixed write rules:
//   working            agents, Atlas or a person; always expires (7 days by default, 30 at most)
//   operational        agents and Atlas write it unverified; a person verifies it
//   project_knowledge  a person, or the repository (seeded records, changed by pull request)
//   human_approved     a person only, verified on write
// Every record is scoped to a building (catalog project) and optionally a workflow; an agent reads
// only its own building's records, records of a workflow it takes part in, and global policies, up
// to its data-sensitivity clearance. Secrets are refused outright. Every write, verification,
// retirement and retrieval goes into the audit log.
//
// Storage: this device (like the Task Center), behind the same Backend interface, with
// compare-and-set on a file revision. Seeded records live in the repository and are merged on read.

const DAY = 86_400_000;
export const WORKING_TTL_DAYS = 7;
export const WORKING_MAX_TTL_DAYS = 30;
export const REVIEW_DAYS: Record<MemoryCategory, number | null> = { working: null, operational: 90, project_knowledge: 180, human_approved: null };
export const MAX_CONTENT = 2000;
export const MAX_AUDIT = 1000;
export const MAX_CONTEXTS = 300;
export const MAX_EVALUATIONS = 1000;
const KEY = "atlas:agent-intel";

export const rank = (s: Sensitivity) => SENSITIVITIES.indexOf(s);

export interface AgentAccess {
  agentId: string;
  known: boolean;
  project: string | null;
  workflows: string[];
  clearance: Sensitivity;
}

/** What an agent may read, worked out from the Agent Registry and the workflow definitions. */
export function agentAccess(catalog: Catalog, agentId: string, definitions: Readonly<Record<string, WorkflowDefinition>> = DEFINITIONS): AgentAccess {
  const a = catalog.agents.find((x) => x.id === agentId);
  const workflows = Object.values(definitions)
    .filter((d) => d.nodes.some((n) => n.agentId === agentId))
    .map((d) => d.id);
  const declared = a?.registry?.governance?.dataSensitivity;
  // Restricted data is never handed to an agent, whatever its manifest says.
  const clearance: Sensitivity = declared && declared !== "restricted" ? declared : declared === "restricted" ? "confidential" : "internal";
  return { agentId, known: !!a, project: a?.projectId ?? null, workflows, clearance };
}

/** Why the agent may not read the record, or null. */
export function readProblem(r: MemoryRecord, acc: AgentAccess, now: number): string | null {
  if (!acc.known) return "unknown-agent";
  if (r.retiredAt) return "retired";
  if (r.expiry.policy === "ttl" && r.expiry.expiresAt && Date.parse(r.expiry.expiresAt) <= now) return "expired";
  if (r.scope.agentIds && !r.scope.agentIds.includes(acc.agentId)) return "scope";
  const inScope = r.scope.project === "global" || r.scope.project === acc.project || (!!r.scope.workflowId && acc.workflows.includes(r.scope.workflowId));
  if (!inScope) return "scope";
  if (r.sensitivity === "restricted" || rank(r.sensitivity) > rank(acc.clearance)) return "clearance";
  if (r.suspicious && r.verification !== "verified") return "suspicious";
  if (r.verification === "disputed") return "disputed";
  return null;
}

export const isStale = (r: MemoryRecord, now: number) => r.expiry.policy === "review" && !!r.expiry.reviewAt && Date.parse(r.expiry.reviewAt) <= now;

export interface MemoryInput {
  category: MemoryCategory;
  scope: MemoryScope;
  title: string;
  content: string;
  tags?: string[];
  source: SourceRef;
  sensitivity?: Sensitivity;
  ttlDays?: number;
}

export type Ok<T> = ({ ok: true } & T) | { ok: false; error: string };

/** Checks one write against the category rules. Pure; the store applies it. */
export function checkWrite(input: MemoryInput, actor: Actor, catalog: Catalog): string | null {
  const person = actor.kind === "person";
  const text = `${input.title}\n${input.content}\n${(input.tags ?? []).join(" ")}\n${input.source.ref}`;
  const secret = secretIn(text);
  if (secret) return `Refused: the text looks like it contains ${secret}. Secrets and credentials are never kept in agent memory.`;
  if (!input.title.trim() || !input.content.trim()) return "A memory needs a title and content.";
  if (input.content.length > MAX_CONTENT) return `Content is longer than ${MAX_CONTENT} characters; link the document as the source instead.`;
  if (!input.scope.project) return "A memory needs a project scope.";
  if (input.scope.project === "global" && input.category !== "human_approved" && input.category !== "project_knowledge") return "Only Khaneil's policies and repository-wide knowledge can be global.";
  if (input.scope.project !== "global" && !catalog.projects.some((p) => p.id === input.scope.project)) return `Unknown building ${input.scope.project}.`;
  if (input.source.url && !isHttps(input.source.url)) return "Source links must be https.";
  if (input.sensitivity === "restricted" && !person) return "Only a person can store restricted information.";
  if (input.category === "human_approved" && !person) return "Only Khaneil can add human-approved memory.";
  if (input.category === "project_knowledge" && !person) return "Project knowledge is added by a person or through the repository. An agent can propose it as an improvement.";
  if (actor.kind === "agent") {
    const acc = agentAccess(catalog, actor.id);
    if (!acc.known) return "Unknown agent.";
    const own = input.scope.project === acc.project || (!!input.scope.workflowId && acc.workflows.includes(input.scope.workflowId));
    if (!own) return "An agent can only write to its own building or a workflow it takes part in.";
  }
  return null;
}

export function newRecord(input: MemoryInput, actor: Actor, at: string, id: string): MemoryRecord {
  const t = Date.parse(at);
  const ttl = Math.min(WORKING_MAX_TTL_DAYS, Math.max(1, input.ttlDays ?? WORKING_TTL_DAYS));
  const review = REVIEW_DAYS[input.category];
  const content = clean(input.content, MAX_CONTENT);
  const title = clean(input.title, 160);
  const suspicious = injectionIn(`${title}\n${content}`) ?? undefined;
  return {
    id,
    category: input.category,
    scope: input.scope,
    title,
    content,
    tags: (input.tags ?? []).map((x) => clean(x, 40).toLowerCase()).filter(Boolean).slice(0, 12),
    source: input.source,
    createdAt: at,
    updatedAt: at,
    createdBy: actor,
    verification: input.category === "human_approved" ? "verified" : "unverified",
    ...(input.category === "human_approved" ? { verifiedBy: actor.name, verifiedAt: at } : {}),
    sensitivity: input.sensitivity ?? "internal",
    expiry: input.category === "working" ? { policy: "ttl", expiresAt: new Date(t + ttl * DAY).toISOString() } : review ? { policy: "review", reviewAt: new Date(t + review * DAY).toISOString() } : { policy: "none" },
    ...(suspicious ? { suspicious } : {}),
  };
}

export const emptyFile = (): IntelligenceFile => ({ version: 1, rev: 0, memory: [], decisions: [], evaluations: [], feedback: [], proposals: [], versions: [], contexts: [], audit: [] });

function parse(raw: string | null): IntelligenceFile {
  if (!raw) return emptyFile();
  try {
    const f = JSON.parse(raw) as Partial<IntelligenceFile>;
    if (f.version !== 1 || typeof f.rev !== "number") return emptyFile();
    const e = emptyFile();
    return { ...e, ...f, version: 1 } as IntelligenceFile;
  } catch {
    return emptyFile();
  }
}

export const localIntelBackend: Backend = {
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

let seq = 0;
export const intelId = (prefix: string) => `${prefix}_${Date.now().toString(36)}${(seq++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** The device store for all intelligence records. Every change is compare-and-set on the file revision. */
export class IntelligenceStore {
  private file: IntelligenceFile;
  private listeners = new Set<() => void>();
  constructor(
    private backend: Backend,
    private catalog: Catalog,
    private now: () => string = () => new Date().toISOString(),
    private seed: readonly MemoryRecord[] = SEED_MEMORY,
  ) {
    this.file = parse(backend.read());
    backend.watch?.(() => {
      this.file = parse(backend.read());
      this.emit();
    });
  }
  setCatalog(c: Catalog) {
    this.catalog = c;
  }
  snapshot(): IntelligenceFile {
    return this.file;
  }
  /** Seeded records from the repository plus this device's records. */
  memory(): readonly MemoryRecord[] {
    return [...this.seed, ...this.file.memory];
  }
  at() {
    return this.now();
  }
  cat() {
    return this.catalog;
  }

  /** Applies one change to a fresh copy of the file. A change returning a string is refused. */
  update(change: (f: IntelligenceFile, at: string) => IntelligenceFile | string): Ok<{ file: IntelligenceFile }> {
    const fresh = parse(this.backend.read());
    const at = this.now();
    const next = change(structuredClone(fresh), at);
    if (typeof next === "string") return { ok: false, error: next };
    if (next.rev !== fresh.rev) return { ok: false, error: "The records changed somewhere else first. Try again." };
    const saved: IntelligenceFile = {
      ...next,
      rev: fresh.rev + 1,
      audit: next.audit.slice(-MAX_AUDIT),
      contexts: next.contexts.slice(-MAX_CONTEXTS),
      evaluations: next.evaluations.slice(-MAX_EVALUATIONS),
    };
    try {
      this.backend.write(JSON.stringify(saved));
    } catch {
      return { ok: false, error: "Couldn't save: this device's storage is full or unavailable." };
    }
    this.file = saved;
    this.emit();
    return { ok: true, file: saved };
  }

  audit(f: IntelligenceFile, actor: Actor, action: AuditEntry["action"], ids: string[], at: string, note?: string): IntelligenceFile {
    return { ...f, audit: [...f.audit, { id: intelId("aud"), at, actor, action, ids, ...(note ? { note: note.slice(0, 200) } : {}) }] };
  }

  write(input: MemoryInput, actor: Actor): Ok<{ record: MemoryRecord }> {
    const problem = checkWrite(input, actor, this.catalog);
    if (problem) {
      // Refusals are audited too, without the refused text.
      this.update((f, at) => this.audit(f, actor, "refused", [], at, problem));
      return { ok: false, error: problem };
    }
    let record!: MemoryRecord;
    const r = this.update((f, at) => {
      record = newRecord(input, actor, at, intelId("mem"));
      return this.audit({ ...f, memory: [...f.memory, record] }, actor, "write", [record.id], at, `${record.category}${record.suspicious ? " (held: instruction-like text)" : ""}`);
    });
    return r.ok ? { ok: true, record } : r;
  }

  /** A person marks a record verified or disputed. Seeded records change only by pull request. */
  verify(id: string, actor: Actor, verdict: "verified" | "disputed"): Ok<object> {
    if (actor.kind !== "person") return { ok: false, error: "Only a person can verify memory." };
    if (id.startsWith("seed:")) return { ok: false, error: "This record lives in the repository; change it with a pull request." };
    const r = this.update((f, at) => {
      const i = f.memory.findIndex((m) => m.id === id);
      if (i < 0) return "No such memory.";
      const m = f.memory[i];
      const review = REVIEW_DAYS[m.category];
      f.memory[i] = { ...m, verification: verdict, verifiedBy: actor.name, verifiedAt: at, updatedAt: at, ...(review && verdict === "verified" ? { expiry: { policy: "review", reviewAt: new Date(Date.parse(at) + review * DAY).toISOString() } } : {}) };
      return this.audit(f, actor, "verify", [id], at, verdict);
    });
    return r.ok ? { ok: true } : r;
  }

  /** A person retires a record. It stays in the file for the audit trail but is never retrieved. */
  retire(id: string, actor: Actor, reason: string): Ok<object> {
    if (actor.kind !== "person") return { ok: false, error: "Only a person can retire memory." };
    const r = this.update((f, at) => {
      const i = f.memory.findIndex((m) => m.id === id);
      if (i < 0) return "No such memory.";
      f.memory[i] = { ...f.memory[i], retiredAt: at, retiredBy: actor.name, updatedAt: at };
      return this.audit(f, actor, "retire", [id], at, clean(reason, 200));
    });
    return r.ok ? { ok: true } : r;
  }

  /** Drops expired working memory from the file (retention). Seeded records never expire. */
  sweep(): number {
    const now = Date.parse(this.now());
    const gone = this.file.memory.filter((m) => m.expiry.policy === "ttl" && m.expiry.expiresAt && Date.parse(m.expiry.expiresAt) <= now).map((m) => m.id);
    if (!gone.length) return 0;
    const r = this.update((f, at) => this.audit({ ...f, memory: f.memory.filter((m) => !gone.includes(m.id)) }, { kind: "system", id: "atlas", name: "Atlas" }, "expire", gone, at));
    return r.ok ? gone.length : 0;
  }

  subscribe(fn: () => void) {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  }
  private emit() {
    this.listeners.forEach((l) => l());
  }
}
