import type { BuildingInstance, ModuleTypeId } from "./types";

/**
 * This workspace's landmark buildings that are not catalog projects (they are drawn by the map
 * itself, selected as `service:<id>`), with the platform module each one houses. `name` is the
 * map's own name for the building (AGENCY_NAME, financialBrand(...).name and so on), which
 * modules.test.ts checks stays in step with the map so nothing is renamed or moved by accident.
 * What the building is called on screen comes from catalog/workspace/buildings.yaml (names.ts).
 *
 * Each building houses the module that matches what it is for (KC's naming, 2026-11-10). A module
 * can have more than one home when both buildings do that work (two finance towers, two
 * commerce buildings). KC, 2026-11-10: the Air Traffic tower and the Terminal are airport
 * scenery and house none; Cargo keeps the Model Intelligence Lab from #321. Buildings whose function no module covers
 * yet house none, rather than borrow an unrelated one.
 */
export const LANDMARK_MODULES: readonly { id: string; name: string; moduleType: ModuleTypeId }[] = [
  { id: "benjaire-marketing", name: "Benjaire Marketing Agency", moduleType: "growth-marketing-studio" },
  { id: "atlas-station", name: "Atlas Central Station", moduleType: "workflow-automation-plant" },
  { id: "bmw-dealership", name: "Vantor Motors", moduleType: "infrastructure-control-tower" },
  { id: "atlas-marketplace", name: "Atlas Marketplace", moduleType: "commerce-product-marketplace" },
  { id: "financial:banks", name: "Bayvale Bank", moduleType: "finance-analytics-tower" },
  { id: "financial:records", name: "Halden Trust", moduleType: "identity-governance-tower" },
  { id: "financial:investments", name: "Robin Exchange", moduleType: "integration-exchange" },
  { id: "financial:residence", name: "Aldren Insights", moduleType: "data-intelligence-center" },
  { id: "financial:business-finance", name: "Corvane Capital", moduleType: "finance-analytics-tower" },
  { id: "financial:financial-planning", name: "Ravelle Advisors", moduleType: "knowledge-repository" },
  { id: "airport-building:operations", name: "Atlas · Operations", moduleType: "observability-center" },
  { id: "airport-building:cargo", name: "Atlas · Cargo", moduleType: "model-intelligence-lab" },
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
