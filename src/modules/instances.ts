import { districtOf } from "../catalog/organization";
import type { Catalog, Project } from "../catalog/types";
import type { Health } from "../lib/derive";
import { moduleAvailability, moduleType } from "./catalog";
import { buildingDisplayName, buildingOrganization, serviceKey } from "./names";
import type { BuildingInstance, ModuleHealth } from "./types";
import { WORKSPACE, isEntitled, type AtlasWorkspace, type LandmarkInstance } from "./workspace";

// Building instances: the workspace's own buildings, read from the catalog projects that already
// put them on the map. This layer only adds metadata. Ids, names, districts and placement come
// straight from the manifest, so existing buildings, saved selections and map layout are untouched.
// A manifest opts a building into a platform module with `project.module`; without it the
// building stays a personal building with no module (moduleType null).

export function buildingInstance(project: Project, catalog: Catalog, workspace: AtlasWorkspace = WORKSPACE): BuildingInstance {
  const type = moduleType(project.module);
  return {
    id: project.id,
    projectId: project.id,
    name: project.name,
    ...(project.organization ? { organization: project.organization } : {}),
    districtId: districtOf(project, catalog.agents).value,
    moduleType: type?.id ?? null,
    moduleProvenance: type ? "declared" : "none",
    enabled: !!type && isEntitled(workspace, type.id) && moduleAvailability(type) !== "planned" && project.status !== "retired",
    health: "unknown",
  };
}

/** One instance per catalog project, in catalog order. */
export function buildingInstances(catalog: Catalog, workspace: AtlasWorkspace = WORKSPACE): BuildingInstance[] {
  return catalog.projects.map((p) => buildingInstance(p, catalog, workspace));
}

/** Landmark buildings (not catalog projects) that house a module. They have no catalog district. */
export function landmarkInstances(workspace: AtlasWorkspace = WORKSPACE): LandmarkInstance[] {
  return workspace.landmarks.map((l) => {
    const type = moduleType(l.moduleType)!;
    const organization = buildingOrganization(serviceKey(l.id));
    return { id: l.id, projectId: null, name: buildingDisplayName(serviceKey(l.id), l.name), ...(organization ? { organization } : {}), districtId: null, moduleType: type.id, moduleProvenance: "declared", enabled: isEntitled(workspace, type.id) && moduleAvailability(type) !== "planned", health: "unknown", ...(l.project ? { linked: { projectId: l.project, workplace: l.name } } : {}) };
  });
}

/** Every building in the workspace: catalog projects first, then landmarks. */
export function workspaceBuildings(catalog: Catalog, workspace: AtlasWorkspace = WORKSPACE): (BuildingInstance | LandmarkInstance)[] {
  return [...buildingInstances(catalog, workspace), ...landmarkInstances(workspace)];
}

/** The workspace buildings that are occurrences of a given module type. */
export function instancesOf<T extends Pick<BuildingInstance, "moduleType">>(instances: T[], type: BuildingInstance["moduleType"]): T[] {
  return instances.filter((i) => i.moduleType === type);
}

/** Maps Atlas's existing health indicator (lib/derive.ts) onto module health. */
export function moduleHealth(h: Health | undefined): ModuleHealth {
  switch (h) {
    case "good": return "healthy";
    case "warn": return "warning";
    case "bad": return "critical";
    default: return "unknown";
  }
}
