import type { ConnectionType } from "../catalog/types";

// The map's three views. Each decides which of the catalog's connections are drawn; none adds a
// connection of its own. Infrastructure keeps the map quiet: lines only for the building in hand,
// or all of them when "Show connections" is on.

export const MAP_LENSES = ["infrastructure", "agents", "automations"] as const;
export type MapLens = (typeof MAP_LENSES)[number];

export const LENS_INFO: Record<MapLens, { label: string; hint: string; empty: string }> = {
  infrastructure: { label: "Infrastructure view", hint: "Select a building to see its connections", empty: "" },
  agents: { label: "Agent network", hint: "Links between agents, from registry dependencies", empty: "No agent links declared yet" },
  automations: { label: "Automation flow", hint: "Repositories to the automations they host, and n8n flows", empty: "No automations with a source or workflow yet" },
};

export interface LensLink {
  id: string;
  type: ConnectionType;
  /** Map keys of both ends, "repo:owner/name" or "agent:id". */
  a: string;
  b: string;
  /** Project ids of both ends. */
  pa?: string;
  pb?: string;
}

export interface LensContext {
  /** Infrastructure only: the toolbar's "Show connections" and its type switches. */
  showAll: boolean;
  types: Record<ConnectionType, boolean>;
  /** Map key of the selected building, if any, and its project id when it is a headquarters. */
  selKey: string | null;
  selProject?: string;
  /** Ids of registered items that run without an AI model. */
  automations: Set<string>;
}

export function lensLinks<T extends LensLink>(all: T[], lens: MapLens, ctx: LensContext): T[] {
  const enabled=all.filter(l=>ctx.types[l.type]);
  if (lens === "agents") return enabled.filter((l) => l.type === "agent" || l.type === "n8n" || l.type === "dependency");
  // "repo:<agent id>" links say which repository hosts an item's source or workflow.
  if (lens === "automations") return enabled.filter((l) => l.type === "n8n" || (l.id.startsWith("repo:") && ctx.automations.has(l.id.slice(5))));
  if (ctx.showAll) return enabled;
  const { selKey, selProject } = ctx;
  if (!selKey) return [];
  return enabled.filter((l) => l.a === selKey || l.b === selKey || (!!selProject && (l.pa === selProject || l.pb === selProject)));
}
