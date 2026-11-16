import type { Catalog } from "../catalog/types";
import type { HealthLoad } from "../observability/health";
import { looksSecret } from "../lib/secretPatterns";
import { INTEGRATION_CATALOG, usable, type IntegrationState } from "./integrations";
import { compatibility, TEMPLATES, type WorkflowTemplate } from "./templates";
import { agentSettingsProblem, agentBlocked, parseWorkspace, type Workspace } from "./workspace";

// Setup validation and configuration transfer. Readiness reads only what Atlas already knows (no
// outside calls, nothing runs). Import treats every file as untrusted: unknown agents, tools,
// integrations and templates are dropped, protected settings are refused, and an imported
// workspace can never grant more than the registry already allows.

export interface Readiness {
  integrations: { connected: number; enabled: number; names: string[] };
  agents: { available: number; disabled: number };
  workflows: { ready: WorkflowTemplate[]; blocked: { template: WorkflowTemplate; reason: string }[] };
  missing: string[];
  warnings: string[];
  next: { label: string; target: "integrations" | "agents" | "templates" | "tasks" | "workflows" };
}

export function readiness(w: Workspace | null, catalog: Catalog, states: readonly IntegrationState[], health: HealthLoad): Readiness {
  // An integration this platform can't use (the Claude key on the web) isn't missing, just elsewhere.
  const enabled = states.filter((s) => w?.enabledIntegrations.includes(s.def.id) && s.status !== "unsupported");
  const connected = enabled.filter(usable);
  const agentIds = (w?.allowedAgents ?? []).filter((id) => catalog.agents.some((a) => a.id === id));
  const disabled = agentIds.filter((id) => agentBlocked(w, id));
  const picked = TEMPLATES.filter((t) => w?.templates.includes(t.id));
  const ready: WorkflowTemplate[] = [];
  const blocked: Readiness["workflows"]["blocked"] = [];
  for (const t of picked) {
    const c = compatibility(t, w, catalog, states);
    if (c.ready) ready.push(t);
    else blocked.push({ template: t, reason: c.problems[0] ?? c.warnings[0] ?? "Not ready." });
  }
  const missing: string[] = [];
  if (!w) missing.push("Create a workspace.");
  for (const s of enabled) if (!usable(s)) missing.push(`${s.def.label}: ${s.detail}`);
  if (w && !agentIds.length) missing.push("Add at least one agent to the workspace.");
  if (w && !picked.length) missing.push("Pick a workflow template.");
  for (const b of blocked) missing.push(`${b.template.name}: ${b.reason}`);

  const warnings: string[] = [];
  const report = health.kind === "ok" ? health.report : null;
  if (report) {
    const cred = (id: string) => report.credentials.find((c) => c.id === id);
    if (cred("access") && !cred("access")!.configured) warnings.push("Cloudflare Access isn't configured: the site refuses every request until it is.");
    if (cred("allowed-emails") && !cred("allowed-emails")!.configured) warnings.push("ALLOWED_EMAILS isn't set, so only the Access policy limits who can sign in.");
    if (report.checks.some((c) => c.critical && c.state === "unavailable")) warnings.push("A critical site check is unavailable. See Production health in Mission Control.");
  }
  if (w?.environment === "production" && !report) warnings.push("The site's health couldn't be read, so security settings weren't checked.");
  for (const s of states) if (s.status === "degraded") warnings.push(`${s.def.label} is degraded: ${s.detail}`);

  const next: Readiness["next"] = !w
    ? { label: "Create your workspace", target: "integrations" }
    : !connected.length
      ? { label: "Connect one integration", target: "integrations" }
      : !agentIds.length || disabled.length === agentIds.length
        ? { label: "Turn on an agent", target: "agents" }
        : !picked.length
          ? { label: "Pick a workflow template", target: "templates" }
          : ready.length
            ? { label: `Simulate ${ready[0].name}`, target: "templates" }
            : { label: "Open the Task Center", target: "tasks" };
  return { integrations: { connected: connected.length, enabled: enabled.length, names: connected.map((s) => s.def.label) }, agents: { available: agentIds.length - disabled.length, disabled: disabled.length }, workflows: { ready, blocked }, missing, warnings: [...new Set(warnings)], next };
}

// ---------------------------------------------------------------------------------------------
// Export and import of workspace configuration.

export const EXPORT_FORMAT = "atlas-workspace";
export const EXPORT_VERSION = 1;
export const MAX_IMPORT_BYTES = 200_000;

/** The workspace as a file to keep or move. No owner reference, no history, no secrets. */
export function exportWorkspace(w: Workspace, at: string): { ok: true; json: string } | { ok: false; error: string } {
  const body = { format: EXPORT_FORMAT, version: EXPORT_VERSION, exportedAt: at, workspace: { ...w, ownerRef: undefined, history: [] } };
  const json = JSON.stringify(body, null, 2);
  if (looksSecret(json)) return { ok: false, error: "Something in this workspace looks like a key, so it wasn't exported. Remove it and try again." };
  return { ok: true, json };
}

export type ImportResult = { ok: true; workspace: Workspace; dropped: string[] } | { ok: false; error: string };

/** Reads an untrusted file. Nothing in it can run, and it can only narrow what the registry allows. */
export function checkImport(text: string, catalog: Catalog): ImportResult {
  if (text.length > MAX_IMPORT_BYTES) return { ok: false, error: "That file is too large to be a workspace export." };
  if (looksSecret(text)) return { ok: false, error: "That file contains something shaped like a key or password, so it was refused. Workspace files never hold credentials." };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: "That isn't a valid workspace file (not JSON)." };
  }
  const f = raw as { format?: string; version?: number; workspace?: Record<string, unknown> };
  if (f?.format !== EXPORT_FORMAT) return { ok: false, error: "That isn't an Atlas workspace export." };
  if (f.version !== EXPORT_VERSION) return { ok: false, error: `Workspace files version ${String(f.version)} aren't supported by this Atlas.` };
  const src = f.workspace ?? {};
  const dropped: string[] = [];
  // Settings that try to reach protected fields are refused one by one, before parsing drops them silently.
  const settings = (src.agentSettings && typeof src.agentSettings === "object" ? src.agentSettings : {}) as Record<string, unknown>;
  for (const [id, s] of Object.entries(settings)) {
    const p = agentSettingsProblem(s);
    if (p) dropped.push(`Settings for ${id}: ${p}`);
  }
  const w = parseWorkspace({ ...src, rev: 1, history: [] });
  if (!w) return { ok: false, error: "The workspace in that file is missing a name, business, purpose, environment or valid time zone." };
  const agents = new Set(catalog.agents.map((a) => a.id));
  const projects = new Set(catalog.projects.map((p) => p.id));
  const integrations = new Set(INTEGRATION_CATALOG.map((i) => i.id));
  const templates = new Set(TEMPLATES.map((t) => t.id));
  const keep = (list: string[], known: Set<string>, what: string) =>
    list.filter((id) => {
      if (known.has(id)) return true;
      dropped.push(`${what} ${id} isn't in this Atlas.`);
      return false;
    });
  w.allowedAgents = keep(w.allowedAgents, agents, "Agent");
  w.projects = keep(w.projects, projects, "Project");
  w.enabledIntegrations = keep(w.enabledIntegrations, integrations, "Integration");
  w.templates = keep(w.templates, templates, "Template");
  for (const id of Object.keys(w.agentSettings)) if (!w.allowedAgents.includes(id)) delete w.agentSettings[id];
  return { ok: true, workspace: w, dropped };
}
