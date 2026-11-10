import type { BuildingInstance, ModuleTypeId } from "./types";

/**
 * This workspace's landmark buildings that are not catalog projects (they are drawn by the map
 * itself, selected as `service:<id>`), with the platform module each one houses. Ids and names
 * mirror AGENCY_KEY/AGENCY_NAME in views/map3d/marketingAgencyPlan.ts and GALLERIA_KEY/GALLERIA_NAME
 * in views/map3d/galleriaPlan.ts, plus the airport tower, the Business Finance tower, the
 * stadium and its station; modules.test.ts checks they stay in step, so nothing on the map
 * is renamed or moved. Chosen by KC, 2026-11-10.
 */
export const LANDMARK_MODULES: readonly { id: string; name: string; moduleType: ModuleTypeId }[] = [
  { id: "benjaire-marketing", name: "Benjaire Marketing Agency", moduleType: "agent-operations-center" },
  { id: "atlas-galleria", name: "Atlas Galleria", moduleType: "workflow-automation-plant" },
  { id: "airport-building:tower", name: "Atlas · Air Traffic", moduleType: "infrastructure-control-tower" },
  { id: "financial:business-finance", name: "Corvane Capital", moduleType: "finance-analytics-tower" },
  { id: "skyline-stadium", name: "Atlas Stadium", moduleType: "growth-marketing-studio" },
  { id: "stadium-station", name: "Stadium Station", moduleType: "integration-exchange" },
];

export type LandmarkInstance = Omit<BuildingInstance, "districtId" | "projectId"> & { districtId: null; projectId: null };
