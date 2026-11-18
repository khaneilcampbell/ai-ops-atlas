import type { ConnectionType } from "../catalog/types";

// The map's three views, in one "Map view" menu. Each decides which of the catalog's connections
// are drawn; none adds a connection of its own. "By district" (key "infrastructure", kept so saved
// choices still load) is the default city: district names on, and lines only for the building in
// hand, or all of them when "Show connections" is on. It replaced the separate Infrastructure view
// and "Group projects" menus, which no longer changed the map on their own.

export const MAP_LENSES = ["infrastructure", "agents", "automations"] as const;
export type MapLens = (typeof MAP_LENSES)[number];

export const LENS_INFO: Record<MapLens, { label: string; hint: string; empty: string }> = {
  infrastructure: { label: "By district", hint: "The city by district. Select a building to see its connections", empty: "" },
  agents: { label: "Agent network", hint: "Links between agents, from registry dependencies", empty: "No agent links declared yet" },
  automations: { label: "Automation flow", hint: "Repositories to the automations they host, and n8n flows", empty: "No automations with a source or workflow yet" },
};

/** The connection colors each view can draw, in key order. Its key lists only these, so every
 * line on the map has a swatch and no swatch names a line the view never shows. */
export const LENS_TYPES: Record<MapLens, readonly ConnectionType[]> = {
  infrastructure: ["github", "agent", "n8n", "dependency"],
  agents: ["agent", "n8n", "dependency"],
  // GitHub here: the repository that hosts each automation's source or workflow.
  automations: ["github", "n8n"],
};

/** Views that draw a network of lines; they need the 3D map. "By district" works in both. */
export const lensNeeds3d = (lens: MapLens) => lens !== "infrastructure";

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
  if (lens === "agents") return enabled.filter((l) => LENS_TYPES.agents.includes(l.type));
  // "repo:<agent id>" links say which repository hosts an item's source or workflow.
  if (lens === "automations") return enabled.filter((l) => l.type === "n8n" || (l.id.startsWith("repo:") && ctx.automations.has(l.id.slice(5))));
  if (ctx.showAll) return enabled;
  const { selKey, selProject } = ctx;
  if (!selKey) return [];
  return enabled.filter((l) => l.a === selKey || l.b === selKey || (!!selProject && (l.pa === selProject || l.pb === selProject)));
}
