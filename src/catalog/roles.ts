import type { Agent } from "./types";

// How the map places each registered item, read from its manifest's registry classification:
// AI agents work at desks inside their project's building, automations get a house beside it.

/** A: AI agent, F: planned agent. B is a predefined AI-assisted automation, not an agent. */
const AI_TYPES = new Set(["A", "F"]);

export function isAiAgent(a: Pick<Agent, "registry">) {
  const t = a.registry?.classification?.type;
  return !!t && AI_TYPES.has(t);
}

/** The runtime an owning agent declares when it has no model or runtime of its own and works only
 *  through the automations that name it in `owned_by` (added 2026-11-13). */
export const THROUGH_AUTOMATIONS = "Through its automations";

/** An owning agent that works only through its automations: it has a desk, but the map does not
 *  draw it walking, because no run of its own happens anywhere. */
export function worksThroughAutomations(a: Pick<Agent, "runtime">) {
  return a.runtime === THROUGH_AUTOMATIONS;
}

/** What the Agents or Automations directory lists: current items of that kind. Retired items stay in
 *  their manifests as history but no longer run anywhere, so the directories leave them out. */
export function directoryItems<T extends Pick<Agent, "registry" | "status">>(agents: T[], kind: "agents" | "automations"): T[] {
  return agents.filter((a) => a.status !== "retired" && (kind === "agents" ? isAiAgent(a) : !isAiAgent(a)));
}

/** Items with no classification in their manifest; the map treats them as automations. */
export function unclassified(agents: Pick<Agent, "id" | "registry">[]) {
  return agents.filter((a) => !a.registry?.classification?.type || a.registry.classification.type === "unclassified");
}

/** Outside services the map shows as a kiosk, when a manifest names one among an item's tools. */
export interface Service {
  id: string;
  /** What the building does (shown on the map). Never a vendor's brand. */
  name: string;
  /** The real outside service the manifests name, shown only as plain text in the panel. */
  vendor: string;
}
const SERVICES: (Service & { re: RegExp })[] = [
  { id: "stripe", name: "Payments Office", vendor: "Stripe", re: /\bstripe\b/i },
  { id: "shopify", name: "Storefront Office", vendor: "Shopify", re: /\bshopify\b/i },
  { id: "cloudflare", name: "Edge Office", vendor: "Cloudflare", re: /\bcloudflare\b/i },
  { id: "splunk", name: "Log Analytics Lab", vendor: "Splunk", re: /\bsplunk\b/i },
  { id: "canva", name: "Design Studio", vendor: "Canva", re: /\bcanva\b/i },
  { id: "serper", name: "Search Desk", vendor: "Serper", re: /\bserper\b/i },
  { id: "n8n", name: "Automation Works", vendor: "n8n", re: /\bn8n\b/i },
];

export interface ServiceUse extends Service {
  /** The items whose manifests name it, in catalog order. */
  users: Agent[];
}

/** The outside services a project's items name in their manifests' tools, in a fixed order. */
export function servicesOf(agents: Agent[]): ServiceUse[] {
  return SERVICES.map(({ re, ...s }) => ({ ...s, users: agents.filter((a) => (a.registry?.responsibilities?.tools ?? []).some((t) => re.test(t))) })).filter((s) => s.users.length);
}

/** "3 AI agents · 2 automations", leaving out a count of zero. */
export function residentsLabel(ai: number, automations: number) {
  const parts = [ai && `${ai} AI ${ai === 1 ? "agent" : "agents"}`, automations && `${automations} ${automations === 1 ? "automation" : "automations"}`].filter(Boolean);
  return parts.length ? parts.join(" · ") : "Nothing registered yet";
}

/** Role of each declared infrastructure tool in a project, separate from its live status. */
export const SERVICE_PURPOSE: Record<string, string> = {
  canva: "Creates visual assets and product mockups used by the project.",
  stripe: "Supports the project's payment and checkout workflows.",
  shopify: "Supports storefront, product catalog, and commerce operations.",
  cloudflare: "Provides hosting and request handling for the project's connected services.",
  splunk: "Supports log analysis, security detection, and operational investigation.",
  serper: "Provides web search inputs for research and discovery workflows.",
  n8n: "Connects services and coordinates automated workflows.",
};
