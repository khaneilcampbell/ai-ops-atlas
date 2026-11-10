import { districtOf } from "../catalog/organization";
import type { Catalog, Project } from "../catalog/types";
import type { Health } from "../lib/derive";
import { moduleAvailability, moduleType } from "./catalog";
import type { BuildingInstance, ModuleHealth } from "./types";

// Building instances: the workspace's own buildings, read from the catalog projects that already
// put them on the map. This layer only adds metadata. Ids, names, districts and placement come
// straight from the manifest, so existing buildings, saved selections and map layout are untouched.
// A manifest opts a building into a platform module with `project.module`; without it the
// building stays a personal building with no module (moduleType null).

export function buildingInstance(project: Project, catalog: Catalog): BuildingInstance {
  const type = moduleType(project.module);
  return {
    id: project.id,
    projectId: project.id,
    name: project.name,
    districtId: districtOf(project, catalog.agents).value,
    moduleType: type?.id ?? null,
    moduleProvenance: type ? "declared" : "none",
    enabled: !!type && moduleAvailability(type) !== "planned" && project.status !== "retired",
    health: "unknown",
  };
}

/** One instance per catalog project, in catalog order. */
export function buildingInstances(catalog: Catalog): BuildingInstance[] {
  return catalog.projects.map((p) => buildingInstance(p, catalog));
}

/** The workspace buildings that are occurrences of a given module type. */
export function instancesOf(instances: BuildingInstance[], type: BuildingInstance["moduleType"]): BuildingInstance[] {
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
