import type { Catalog } from "../catalog/types";
import { buildingInstance, landmarkInstances } from "./instances";
import type { BuildingInstance, ModuleAvailability } from "./types";
import { moduleAvailability, moduleType } from "./catalog";
import { integrationLabel } from "./integrations";
import type { LandmarkInstance } from "./workspace";

/** The selection shapes a building can be picked by on the map (state.tsx Selection). */
export type BuildingSelection = { kind: "project" | "service" | "agent" | "repo"; id: string } | null;

/**
 * The workspace building behind a map selection, or undefined when the selection is not a
 * building (an agent, a repository, a tool, a park) or the building houses no module. Lookup is
 * by stable id only, never by display name.
 */
export function buildingForSelection(selection: BuildingSelection, catalog: Catalog): BuildingInstance | LandmarkInstance | undefined {
  if (!selection) return undefined;
  if (selection.kind === "project") {
    const project = catalog.projects.find((p) => p.id === selection.id);
    const b = project && buildingInstance(project, catalog);
    return b?.moduleType ? b : undefined;
  }
  if (selection.kind === "service") return landmarkInstances().find((l) => l.id === selection.id);
  return undefined;
}

/** What a landmark's module can do today, for the plain-words header a building shows before
 *  its module card: undefined when the landmark houses no module. */
export function landmarkModuleStatus(landmarkId: string): { name: string; availability: ModuleAvailability; connectors: string[] } | undefined {
  const type = moduleType(landmarkInstances().find((l) => l.id === landmarkId)?.moduleType);
  if (!type) return undefined;
  return { name: type.name, availability: moduleAvailability(type), connectors: type.connectors.map(integrationLabel) };
}
