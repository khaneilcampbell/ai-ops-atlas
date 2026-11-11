import type { AtlasModuleType, ModuleView } from "./types";

// The workspace layer: what a building opens into once its module is known. One module type maps
// to one workspace definition, and every building that houses that module (a catalog project or a
// map landmark) gets the same workspace. Nothing here is keyed by building.

/** One panel of a module's workspace: a list the inspector shows under the module card. */
export interface WorkspacePanel<C = unknown> {
  /** The capability (catalog.ts) this panel is the evidence for. The panel shows only while the
   *  capability is available, so a planned capability can never show a live-looking list. */
  capability: string;
  /** The panel's accessible name, which is also its `<details>` summary prefix. */
  label: string;
  /** The component that renders it. Kept generic so this file needs no React import. */
  component: C;
}

/** The panels of a module's workspace that its catalog entry currently backs, in table order. */
export function panelsFor<C>(type: AtlasModuleType, table: Partial<Record<AtlasModuleType["id"], readonly WorkspacePanel<C>[]>>): WorkspacePanel<C>[] {
  const available = new Set(type.capabilities.filter((c) => c.state === "available").map((c) => c.id));
  return (table[type.id] ?? []).filter((p) => available.has(p.capability));
}

/** The Atlas views a module's workspace opens into, in catalog order; the map is where the
 *  building already is, so it is never offered as a destination. */
export function workspaceViews(type: AtlasModuleType): ModuleView[] {
  return type.views.filter((v) => v !== "map");
}

/**
 * How opening a workspace view from a building scopes that view. The Agents and Automations
 * directories can filter by project, so a building that is a catalog project opens them on its own
 * agents; every other view, and every landmark building, opens unscoped.
 */
export function workspaceScope(view: ModuleView, projectId: string | null): { project: string } | null {
  return projectId && (view === "agents" || view === "automations") ? { project: projectId } : null;
}
