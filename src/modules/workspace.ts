import type { BuildingInstance, ModuleTypeId } from "./types";

/**
 * This workspace's landmark buildings that are not catalog projects (they are drawn by the map
 * itself, selected as `service:<id>`), with the platform module each one houses. Ids and names
 * mirror AGENCY_KEY/AGENCY_NAME in views/map3d/marketingAgencyPlan.ts and GALLERIA_KEY/GALLERIA_NAME
 * in views/map3d/galleriaPlan.ts; modules.test.ts checks they stay in step, so nothing on the map
 * is renamed or moved. Chosen by KC, 2026-11-10.
 */
export const LANDMARK_MODULES: readonly { id: string; name: string; moduleType: ModuleTypeId }[] = [
  { id: "benjaire-marketing", name: "Benjaire Marketing Agency", moduleType: "agent-operations-center" },
  { id: "atlas-galleria", name: "Atlas Galleria", moduleType: "workflow-automation-plant" },
];

export type LandmarkInstance = Omit<BuildingInstance, "districtId" | "projectId"> & { districtId: null; projectId: null };
