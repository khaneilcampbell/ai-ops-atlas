import type { Catalog } from "../catalog/types";
import { buildingInstance, landmarkInstances } from "./instances";
import type { BuildingInstance } from "./types";
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
