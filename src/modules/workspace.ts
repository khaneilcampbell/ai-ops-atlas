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
  { id: "airport-building:operations", name: "Atlas · Operations", moduleType: "observability-center" },
  { id: "financial:business-finance", name: "Corvane Capital", moduleType: "finance-analytics-tower" },
  { id: "skyline-stadium", name: "Atlas Stadium", moduleType: "growth-marketing-studio" },
  { id: "stadium-station", name: "Stadium Station", moduleType: "integration-exchange" },
];

/**
 * A workspace: the business or person using Atlas, its own building names for landmark modules,
 * and the module types it may use. Everything business-specific lives here or in its catalog
 * manifests; the module types (catalog.ts) stay generic, so another workspace reuses them under
 * its own names. Entitlements only decide what the page shows as switched on. They are not a
 * security boundary: protected actions are authorized where they run (the Rust shell or the
 * site's server functions).
 */
export interface AtlasWorkspace {
  id: string;
  name: string;
  landmarks: readonly LandmarkAssignment[];
  /** Module types this workspace may use, or "all". */
  entitlements: readonly ModuleTypeId[] | "all";
}

export type LandmarkAssignment = (typeof LANDMARK_MODULES)[number];

/** This Atlas install's workspace. */
export const WORKSPACE: AtlasWorkspace = { id: "benjaire", name: "Benjaire", landmarks: LANDMARK_MODULES, entitlements: "all" };

export function isEntitled(workspace: Pick<AtlasWorkspace, "entitlements">, type: ModuleTypeId | null | undefined): boolean {
  return !!type && (workspace.entitlements === "all" || workspace.entitlements.includes(type));
}

export type LandmarkInstance = Omit<BuildingInstance, "districtId" | "projectId"> & { districtId: null; projectId: null };
