import type { Agent } from "./types";

// How the map places each registered item, read from its manifest's registry classification:
// AI agents work at desks inside their project's building, automations get a house beside it.

/** A: AI agent, B: AI-assisted workflow, F: planned agent. C, D and E run without an AI model. */
const AI_TYPES = new Set(["A", "B", "F"]);

export function isAiAgent(a: Pick<Agent, "registry">) {
  const t = a.registry?.classification?.type;
  return !!t && AI_TYPES.has(t);
}

/** Items with no classification in their manifest; the map treats them as automations. */
export function unclassified(agents: Pick<Agent, "id" | "registry">[]) {
  return agents.filter((a) => !a.registry?.classification?.type || a.registry.classification.type === "unclassified");
}

/** Outside services the map shows as a kiosk, when a manifest names one among an item's tools. */
export interface Service {
  id: string;
  name: string;
}
const SERVICES: (Service & { re: RegExp })[] = [
  { id: "stripe", name: "Stripe", re: /\bstripe\b/i },
  { id: "shopify", name: "Shopify", re: /\bshopify\b/i },
  { id: "cloudflare", name: "Cloudflare", re: /\bcloudflare\b/i },
  { id: "splunk", name: "Splunk", re: /\bsplunk\b/i },
  { id: "canva", name: "Canva", re: /\bcanva\b/i },
  { id: "serper", name: "Serper", re: /\bserper\b/i },
  { id: "n8n", name: "n8n", re: /\bn8n\b/i },
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
