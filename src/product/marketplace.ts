import type { Agent, Catalog } from "../catalog/types";
import { AGENT_GRANTS, grantsFor, SIDE_EFFECT_LABEL } from "../intelligence/capabilities";
import { CATEGORY_LABEL } from "../registry/types";
import type { AgentSettings, Workspace } from "./workspace";

// Agent library: every agent already in the owner's Agent Registry, described the same way, so a
// workspace can see what it could use. This is a private list, not a public marketplace: "adding"
// only puts the registered agent on the workspace's allowed list; nothing is downloaded, nothing is
// sold, and no outside code runs. Approved
// configuration templates are fixed presets of the few settings an owner may change.

export interface CatalogEntry {
  id: string;
  name: string;
  category: string;
  description: string;
  building: string;
  capabilities: string[];
  requiredIntegrations: string[];
  environment: string;
  permissions: string[];
  version: string;
  configRequirements: string[];
  status: Agent["status"];
  installed: boolean;
  /** Manual agents and automations that only a person runs. */
  automation: boolean;
}

/** Integration Center ids an agent relies on, from its runtime, observers and granted tools. */
export function integrationsFor(a: Agent): string[] {
  const out = new Set<string>();
  const text = `${a.framework} ${a.runtime ?? ""}`;
  if (/n8n/i.test(text)) out.add("n8n");
  if (a.observe?.githubWorkflow || /github/i.test(text)) out.add("github");
  if (a.observe?.atlasIntel) out.add("anthropic");
  const grants = AGENT_GRANTS[a.id] ?? [];
  if (grants.some((g) => g.startsWith("model.") || g === "research.web_search" || g === "handoff.report")) out.add("n8n");
  return [...out];
}

export function catalogEntries(catalog: Catalog, w: Workspace | null): CatalogEntry[] {
  const buildings = new Map(catalog.projects.map((p) => [p.id, p.name]));
  return catalog.agents
    .filter((a) => a.status !== "retired")
    .map((a) => {
      const grants = grantsFor(a.id);
      const r = a.registry;
      const integrations = integrationsFor(a);
      const configRequirements = [
        ...integrations.map((i) => `Connect ${i === "anthropic" ? "Anthropic" : i === "n8n" ? "n8n" : "GitHub"}`),
        ...(r?.governance?.credentialOwner ? [`Credentials held by ${r.governance.credentialOwner}`] : []),
        ...(r?.governance?.approval ? [`Approval: ${r.governance.approval}`] : []),
      ];
      return {
        id: a.id,
        name: a.name,
        category: r?.category ? CATEGORY_LABEL[r.category] : "Uncategorized",
        description: r?.summary ?? a.purpose,
        building: buildings.get(a.projectId) ?? a.projectId,
        capabilities: grants.length ? grants.map((g) => g.name) : (a.capabilities ?? r?.responsibilities?.tasks ?? []),
        requiredIntegrations: integrations,
        environment: r?.execution?.environment ?? a.runtime ?? a.framework,
        permissions: [...(a.permissions ?? []), ...[...new Set(grants.map((g) => SIDE_EFFECT_LABEL[g.sideEffect]))]],
        version: r?.version ?? "Not versioned",
        configRequirements: [...new Set(configRequirements)],
        status: a.status,
        installed: !!w?.allowedAgents.includes(a.id),
        automation: !r,
      };
    })
    .sort((a, b) => Number(b.installed) - Number(a.installed) || a.name.localeCompare(b.name));
}

/** Approved configuration templates: the only presets an owner applies with one click. */
export const CONFIG_PRESETS: readonly { id: string; label: string; description: string; settings: Omit<AgentSettings, "note"> }[] = [
  { id: "standard", label: "Standard", description: "On, with the model tiers its registry entry allows.", settings: { enabled: true, maxModelTier: 2 } },
  { id: "economy", label: "Economy", description: "On, lightweight models only. Steps that need advanced models hold the run.", settings: { enabled: true, maxModelTier: 1 } },
  { id: "no-ai", label: "No AI", description: "On, but no model calls: only manual and rule-based steps.", settings: { enabled: true, maxModelTier: 0 } },
  { id: "paused", label: "Paused", description: "Off in this workspace. Workflows that need it can't start.", settings: { enabled: false, maxModelTier: 2 } },
];

export function filterEntries(entries: readonly CatalogEntry[], q: string, category: string, show: "all" | "installed" | "available"): CatalogEntry[] {
  const needle = q.trim().toLowerCase();
  return entries.filter(
    (e) =>
      (show === "all" || (show === "installed") === e.installed) &&
      (!category || e.category === category) &&
      (!needle || `${e.name} ${e.description} ${e.building} ${e.capabilities.join(" ")}`.toLowerCase().includes(needle)),
  );
}
