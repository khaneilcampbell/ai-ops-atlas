import { useSyncExternalStore } from "react";
import type { Backend } from "../tasks/store";
import type { Actor } from "../tasks/types";
import { looksSecret } from "../lib/secretPatterns";
import { writeWithRoom } from "../lib/storage";

// Workspaces: the configuration layer that turns Atlas from one owner's dashboard into a product a
// new person can set up. A workspace names the business it runs for and chooses which registered
// agents, integrations and workflow templates it uses. It holds no secrets (those stay in the
// Keychain or Cloudflare secrets) and no records of its own: tasks, runs and business records keep
// their own device stores. Saved on this device under atlas:product, compare-and-set on `rev`.

export const PRODUCT_KEY = "atlas:product";
const VERSION = 1;
export const MAX_HISTORY = 50;

export const ENVIRONMENTS = ["production", "staging", "development"] as const;
export type Environment = (typeof ENVIRONMENTS)[number];
export const ENVIRONMENT_LABEL: Record<Environment, string> = { production: "Production", staging: "Staging", development: "Development" };

export const PURPOSES = ["business", "engineering", "agency", "personal", "other"] as const;
export type Purpose = (typeof PURPOSES)[number];
export const PURPOSE_LABEL: Record<Purpose, string> = {
  business: "Run a business's AI operations",
  engineering: "Watch repositories and engineering agents",
  agency: "Run AI work for clients",
  personal: "Personal projects",
  other: "Something else",
};

/** Settings an owner may change for one agent inside a workspace. Everything else is protected. */
export interface AgentSettings {
  enabled: boolean;
  /** Highest model tier this workspace lets the agent use: 0 no AI, 1 lightweight, 2 advanced. */
  maxModelTier: 0 | 1 | 2;
  note: string;
}

export interface ConfigChange {
  at: string;
  actor: string;
  agentId: string;
  summary: string;
  before: AgentSettings;
  after: AgentSettings;
}

export interface WorkspaceDefaults {
  timeZone: string;
  /** Show the guided setup tips on the Workspace page. */
  tips: boolean;
}

export interface Workspace {
  id: string;
  rev: number;
  name: string;
  description: string;
  purpose: Purpose;
  /** The business or project this workspace runs for, used to fill templates (never hardcoded). */
  primaryBusiness: string;
  /** Reference to the owner, never an email or secret: Actor id of the person who made it. */
  ownerRef: string;
  createdAt: string;
  updatedAt: string;
  environment: Environment;
  /** Atlas project (building) ids. Existing ids are kept as they are. */
  projects: string[];
  /** Registered agent ids this workspace may use. */
  allowedAgents: string[];
  /** Integration Center ids the owner turned on for this workspace. */
  enabledIntegrations: string[];
  /** Workflow template ids picked for this workspace. */
  templates: string[];
  defaults: WorkspaceDefaults;
  agentSettings: Record<string, AgentSettings>;
  history: ConfigChange[];
}

export type OnboardingStatus = "not_started" | "in_progress" | "completed" | "skipped" | "migrated";

export interface Onboarding {
  status: OnboardingStatus;
  step: number;
  updatedAt: string;
  completedAt?: string;
}

export interface ProductFile {
  version: number;
  activeId: string | null;
  workspaces: Workspace[];
  onboarding: Onboarding;
}

export type Ok<T = object> = ({ ok: true } & T) | { ok: false; error: string };

export const DEFAULT_AGENT_SETTINGS: AgentSettings = { enabled: true, maxModelTier: 2, note: "" };

const EMPTY = (at: string): ProductFile => ({ version: VERSION, activeId: null, workspaces: [], onboarding: { status: "not_started", step: 0, updatedAt: at } });

// ---------------------------------------------------------------------------------------------
// Validation: every write and every import goes through these. Plain rules, no model calls.

const LIMITS = { name: 60, description: 400, business: 80, note: 300 } as const;
const ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
// Control characters are replaced so names can't break layouts or logs.
const clean = (s: unknown, max: number) => (typeof s === "string" ? [...s].map((c) => (c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127 ? " " : c)).join("").trim().slice(0, max) : "");

export interface WorkspaceInput {
  name: string;
  description?: string;
  purpose: Purpose;
  primaryBusiness: string;
  environment: Environment;
  timeZone: string;
}

export function validTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return tz.length > 0;
  } catch {
    return false;
  }
}

/** Null when the input is valid, otherwise what to fix, in plain words. */
export function workspaceProblem(input: Partial<WorkspaceInput>): string | null {
  const name = clean(input.name, 200);
  if (!name) return "Give the workspace a name.";
  if (name.length > LIMITS.name) return `Keep the name under ${LIMITS.name} characters.`;
  if (!clean(input.primaryBusiness, 200)) return "Name the business or project this workspace runs for.";
  if (clean(input.primaryBusiness, 200).length > LIMITS.business) return `Keep the business name under ${LIMITS.business} characters.`;
  if (clean(input.description, 1000).length > LIMITS.description) return `Keep the description under ${LIMITS.description} characters.`;
  if (!input.purpose || !PURPOSES.includes(input.purpose)) return "Pick what the workspace is for.";
  if (!input.environment || !ENVIRONMENTS.includes(input.environment)) return "Pick an operating environment.";
  if (!input.timeZone || !validTimeZone(input.timeZone)) return "Pick a valid time zone.";
  for (const v of [input.name, input.description, input.primaryBusiness]) if (typeof v === "string" && looksSecret(v)) return "That looks like a key or password. Workspace details are not secret storage; keys go in the Keychain or Cloudflare secrets.";
  return null;
}

export function agentSettingsProblem(s: unknown): string | null {
  if (!s || typeof s !== "object") return "Agent settings must be an object.";
  const keys = Object.keys(s);
  const extra = keys.filter((k) => !["enabled", "maxModelTier", "note"].includes(k));
  if (extra.length) return `${extra.join(", ")} ${extra.length > 1 ? "are" : "is"} protected and can't be changed here. Tools, permissions, memory scope and building change only through a reviewed registry pull request.`;
  const v = s as Partial<AgentSettings>;
  if (typeof v.enabled !== "boolean") return "enabled must be true or false.";
  if (v.maxModelTier !== 0 && v.maxModelTier !== 1 && v.maxModelTier !== 2) return "maxModelTier must be 0, 1 or 2.";
  if (typeof v.note !== "string" || v.note.length > LIMITS.note) return `Keep the note under ${LIMITS.note} characters.`;
  if (looksSecret(v.note)) return "That note looks like it holds a key. Keys never go in workspace settings.";
  return null;
}

const ids = (xs: unknown): string[] => (Array.isArray(xs) ? [...new Set(xs.filter((x): x is string => typeof x === "string" && ID.test(x)))] : []);

/** Reads one stored or imported workspace; anything malformed is dropped, never repaired by guessing. */
export function parseWorkspace(raw: unknown): Workspace | null {
  if (!raw || typeof raw !== "object") return null;
  const w = raw as Partial<Workspace>;
  if (typeof w.id !== "string" || !ID.test(w.id) || typeof w.rev !== "number") return null;
  const input = { name: w.name, description: w.description, purpose: w.purpose, primaryBusiness: w.primaryBusiness, environment: w.environment, timeZone: w.defaults?.timeZone } as Partial<WorkspaceInput>;
  if (workspaceProblem(input)) return null;
  const agentSettings: Record<string, AgentSettings> = {};
  for (const [id, s] of Object.entries(w.agentSettings ?? {})) if (ID.test(id) && !agentSettingsProblem(s)) agentSettings[id] = s as AgentSettings;
  return {
    id: w.id,
    rev: w.rev,
    name: clean(w.name, LIMITS.name),
    description: clean(w.description, LIMITS.description),
    purpose: w.purpose!,
    primaryBusiness: clean(w.primaryBusiness, LIMITS.business),
    ownerRef: clean(w.ownerRef, 64) || "owner",
    createdAt: typeof w.createdAt === "string" ? w.createdAt : new Date(0).toISOString(),
    updatedAt: typeof w.updatedAt === "string" ? w.updatedAt : new Date(0).toISOString(),
    environment: w.environment!,
    projects: ids(w.projects),
    allowedAgents: ids(w.allowedAgents),
    enabledIntegrations: ids(w.enabledIntegrations),
    templates: ids(w.templates),
    defaults: { timeZone: w.defaults!.timeZone, tips: w.defaults?.tips !== false },
    agentSettings,
    history: Array.isArray(w.history) ? w.history.filter((h) => h && typeof h.agentId === "string" && !agentSettingsProblem(h.before) && !agentSettingsProblem(h.after)).slice(-MAX_HISTORY) : [],
  };
}

export function parseProduct(raw: string | null, at = new Date().toISOString()): ProductFile {
  if (!raw) return EMPTY(at);
  try {
    const f = JSON.parse(raw) as Partial<ProductFile>;
    if (f.version !== VERSION) return EMPTY(at);
    const workspaces = (Array.isArray(f.workspaces) ? f.workspaces : []).map(parseWorkspace).filter((w): w is Workspace => !!w);
    const o = f.onboarding;
    const status: OnboardingStatus = o && ["not_started", "in_progress", "completed", "skipped", "migrated"].includes(o.status) ? o.status : "not_started";
    const activeId = workspaces.some((w) => w.id === f.activeId) ? f.activeId! : (workspaces[0]?.id ?? null);
    return { version: VERSION, activeId, workspaces, onboarding: { status, step: typeof o?.step === "number" ? Math.max(0, Math.min(5, Math.floor(o.step))) : 0, updatedAt: o?.updatedAt ?? at, completedAt: o?.completedAt } };
  } catch {
    return EMPTY(at);
  }
}

// ---------------------------------------------------------------------------------------------
// Migration: an install that already has Atlas data never sees the first-run wizard. It gets one
// workspace built from what is already there (the existing owner's business, every cataloged
// project and agent, the time zone in Settings), so nothing it had changes meaning.

/** Storage keys that only exist after someone has used Atlas. */
const USED_KEYS = ["settings", "tasks", "workflow-runs", "workflow-exec", "business", "agent-intel", "repoCache", "timeZone", "mapMode", "installHintDismissed"];

export function hasExistingData(keys: readonly string[]): boolean {
  return keys.some((k) => k.startsWith("atlas:") && k !== PRODUCT_KEY && USED_KEYS.includes(k.slice(6)));
}

export interface MigrationSource {
  projects: string[];
  agents: string[];
  integrations: string[];
  templates: string[];
  timeZone: string;
}

export const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "workspace";

export function existingWorkspace(src: MigrationSource, actor: Actor, at: string): Workspace {
  return {
    id: "benjaire",
    rev: 1,
    name: "Benjaire",
    description: "Khaneil's existing Atlas: Benjaire's agents, products, repositories and infrastructure.",
    purpose: "business",
    primaryBusiness: "Benjaire",
    ownerRef: actor.id,
    createdAt: at,
    updatedAt: at,
    environment: "production",
    projects: src.projects,
    allowedAgents: src.agents,
    enabledIntegrations: src.integrations,
    templates: src.templates,
    defaults: { timeZone: validTimeZone(src.timeZone) ? src.timeZone : "America/New_York", tips: false },
    agentSettings: {},
    history: [],
  };
}

// ---------------------------------------------------------------------------------------------
// The store.

export const localProductBackend: Backend = {
  read: () => {
    try {
      return localStorage.getItem(PRODUCT_KEY);
    } catch {
      return null;
    }
  },
  write: (raw) => writeWithRoom(PRODUCT_KEY, raw),
  watch: (fn) => {
    const on = (e: StorageEvent) => e.key === PRODUCT_KEY && fn();
    window.addEventListener("storage", on);
    return () => window.removeEventListener("storage", on);
  },
};

export class ProductStore {
  private file: ProductFile;
  private listeners = new Set<() => void>();
  constructor(private backend: Backend) {
    this.file = parseProduct(backend.read());
    backend.watch?.(() => {
      this.file = parseProduct(backend.read());
      this.emit();
    });
  }
  get snapshot(): ProductFile {
    return this.file;
  }
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  private emit() {
    for (const l of this.listeners) l();
  }
  /** Re-reads the stored copy, applies the change, writes it back. */
  private commit(change: (f: ProductFile) => Ok | ProductFile): Ok {
    const fresh = parseProduct(this.backend.read());
    const out = change(structuredClone(fresh));
    if ("ok" in out) return out;
    try {
      this.backend.write(JSON.stringify(out));
    } catch {
      return { ok: false, error: "This device's storage is full, so the change wasn't saved." };
    }
    this.file = out;
    this.emit();
    return { ok: true };
  }

  active(): Workspace | null {
    return this.file.workspaces.find((w) => w.id === this.file.activeId) ?? null;
  }

  /** First launch on a device that already has Atlas data: keep everything, skip the wizard. */
  migrate(src: MigrationSource, actor: Actor, at: string): Ok {
    return this.commit((f) => {
      if (f.workspaces.length || f.onboarding.status !== "not_started") return { ok: true };
      f.workspaces = [existingWorkspace(src, actor, at)];
      f.activeId = f.workspaces[0].id;
      f.onboarding = { status: "migrated", step: 5, updatedAt: at, completedAt: at };
      return f;
    });
  }

  create(input: WorkspaceInput, actor: Actor, at: string, picks: Partial<Pick<Workspace, "projects" | "allowedAgents" | "enabledIntegrations" | "templates">> = {}): Ok<{ id: string }> {
    if (actor.kind !== "person") return { ok: false, error: "Only a person can create a workspace." };
    const problem = workspaceProblem(input);
    if (problem) return { ok: false, error: problem };
    let id = "";
    const r = this.commit((f) => {
      const base = slug(input.name);
      id = base;
      for (let n = 2; f.workspaces.some((w) => w.id === id); n++) id = `${base}-${n}`;
      f.workspaces.push({
        id,
        rev: 1,
        name: clean(input.name, LIMITS.name),
        description: clean(input.description, LIMITS.description),
        purpose: input.purpose,
        primaryBusiness: clean(input.primaryBusiness, LIMITS.business),
        ownerRef: actor.id,
        createdAt: at,
        updatedAt: at,
        environment: input.environment,
        projects: ids(picks.projects),
        allowedAgents: ids(picks.allowedAgents),
        enabledIntegrations: ids(picks.enabledIntegrations),
        templates: ids(picks.templates),
        defaults: { timeZone: input.timeZone, tips: true },
        agentSettings: {},
        history: [],
      });
      f.activeId = id;
      return f;
    });
    return r.ok ? { ok: true, id } : r;
  }

  /** Edits workspace details or lists. `rev` must match the stored copy. */
  update(id: string, rev: number, patch: Partial<WorkspaceInput> & Partial<Pick<Workspace, "projects" | "allowedAgents" | "enabledIntegrations" | "templates">> & { tips?: boolean }, actor: Actor, at: string): Ok {
    if (actor.kind !== "person") return { ok: false, error: "Only a person can change a workspace." };
    return this.commit((f) => {
      const w = f.workspaces.find((x) => x.id === id);
      if (!w) return { ok: false, error: "That workspace no longer exists." };
      if (w.rev !== rev) return { ok: false, error: "This workspace changed in another window. Reopen it and try again." };
      const next = {
        name: patch.name ?? w.name,
        description: patch.description ?? w.description,
        purpose: patch.purpose ?? w.purpose,
        primaryBusiness: patch.primaryBusiness ?? w.primaryBusiness,
        environment: patch.environment ?? w.environment,
        timeZone: patch.timeZone ?? w.defaults.timeZone,
      };
      const problem = workspaceProblem(next);
      if (problem) return { ok: false, error: problem };
      Object.assign(w, {
        name: clean(next.name, LIMITS.name),
        description: clean(next.description, LIMITS.description),
        purpose: next.purpose,
        primaryBusiness: clean(next.primaryBusiness, LIMITS.business),
        environment: next.environment,
        defaults: { timeZone: next.timeZone, tips: patch.tips ?? w.defaults.tips },
        rev: w.rev + 1,
        updatedAt: at,
      });
      if (patch.projects) w.projects = ids(patch.projects);
      if (patch.allowedAgents) w.allowedAgents = ids(patch.allowedAgents);
      if (patch.enabledIntegrations) w.enabledIntegrations = ids(patch.enabledIntegrations);
      if (patch.templates) w.templates = ids(patch.templates);
      return f;
    });
  }

  /** Changes one agent's workspace settings and records the change. Protected fields are refused. */
  configureAgent(id: string, rev: number, agentId: string, settings: unknown, actor: Actor, at: string): Ok {
    if (actor.kind !== "person") return { ok: false, error: `${actor.name} can't change agent settings; only a person can.` };
    const problem = agentSettingsProblem(settings);
    if (problem) return { ok: false, error: problem };
    const after = settings as AgentSettings;
    return this.commit((f) => {
      const w = f.workspaces.find((x) => x.id === id);
      if (!w) return { ok: false, error: "That workspace no longer exists." };
      if (w.rev !== rev) return { ok: false, error: "This workspace changed in another window. Reopen it and try again." };
      if (!w.allowedAgents.includes(agentId)) return { ok: false, error: "Add the agent to this workspace before configuring it." };
      const before = w.agentSettings[agentId] ?? DEFAULT_AGENT_SETTINGS;
      const summary = describeChange(before, after);
      if (!summary) return { ok: true };
      w.agentSettings[agentId] = { enabled: after.enabled, maxModelTier: after.maxModelTier, note: after.note.trim() };
      w.history = [...w.history, { at, actor: actor.name, agentId, summary, before, after: w.agentSettings[agentId] }].slice(-MAX_HISTORY);
      w.rev += 1;
      w.updatedAt = at;
      return f;
    });
  }

  select(id: string): Ok {
    return this.commit((f) => {
      if (!f.workspaces.some((w) => w.id === id)) return { ok: false, error: "That workspace no longer exists." };
      f.activeId = id;
      return f;
    });
  }

  setOnboarding(status: OnboardingStatus, step: number, at: string): Ok {
    return this.commit((f) => {
      f.onboarding = { status, step: Math.max(0, Math.min(5, step)), updatedAt: at, completedAt: status === "completed" || status === "skipped" ? at : f.onboarding.completedAt };
      return f;
    });
  }

  /** Adds an imported workspace that already passed `checkImport`. Never replaces an existing one. */
  addImported(w: Workspace, actor: Actor, at: string): Ok<{ id: string }> {
    if (actor.kind !== "person") return { ok: false, error: "Only a person can import a workspace." };
    let id = "";
    const r = this.commit((f) => {
      id = w.id;
      for (let n = 2; f.workspaces.some((x) => x.id === id); n++) id = `${w.id}-${n}`.slice(0, 64);
      f.workspaces.push({ ...w, id, rev: 1, ownerRef: actor.id, createdAt: at, updatedAt: at, history: [] });
      return f;
    });
    return r.ok ? { ok: true, id } : r;
  }
}

const TIER_WORD = ["no AI", "lightweight AI", "advanced AI"];

export function describeChange(a: AgentSettings, b: AgentSettings): string {
  const out: string[] = [];
  if (a.enabled !== b.enabled) out.push(b.enabled ? "Enabled" : "Disabled");
  if (a.maxModelTier !== b.maxModelTier) out.push(`Model limit ${TIER_WORD[a.maxModelTier]} → ${TIER_WORD[b.maxModelTier]}`);
  if (a.note.trim() !== b.note.trim()) out.push("Note changed");
  return out.join(" · ");
}

export const settingsFor = (w: Workspace | null, agentId: string): AgentSettings => w?.agentSettings[agentId] ?? DEFAULT_AGENT_SETTINGS;

/** Null when the workspace lets the agent run, otherwise why not. No workspace means no limits. */
export function agentBlocked(w: Workspace | null, agentId: string): string | null {
  if (!w) return null;
  if (!w.allowedAgents.includes(agentId)) return `isn't added to the ${w.name} workspace`;
  if (!settingsFor(w, agentId).enabled) return `is turned off in the ${w.name} workspace`;
  return null;
}

let singleton: ProductStore | null = null;
export function productStore(): ProductStore {
  singleton ??= new ProductStore(localProductBackend);
  return singleton;
}

export function useProduct(): ProductFile {
  const s = productStore();
  return useSyncExternalStore(s.subscribe, () => s.snapshot);
}

export function useWorkspace(): Workspace | null {
  const f = useProduct();
  return f.workspaces.find((w) => w.id === f.activeId) ?? null;
}
