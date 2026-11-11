import type { IntegrationId } from "./integrations";
// Building module contract (Phase 1 of the commercial architecture, docs/building-modules.md).
//
// Three layers, kept apart on purpose:
// - A module TYPE is a standard platform capability ("Business Operations HQ"). It is static,
//   lives in ./catalog.ts and never names a workspace, a person or a business.
// - A building INSTANCE is one occurrence of a module type in a workspace ("Business Operations HQ", owned by Benjaire). It is
//   derived from an existing catalog project, so the building's id, name and map placement stay
//   exactly what the manifest says today.
// - Health is observed at runtime and is never stored on a type or in a manifest.

import type { DistrictId } from "../catalog/taxonomy";

/** Product districts that group module types in the platform catalog. These are a product
 *  taxonomy only: the map keeps its own districts (catalog/taxonomy.ts DISTRICTS). */
export const PRODUCT_DISTRICTS = ["command-governance", "ai-automation", "infrastructure-engineering", "business-operations", "data-intelligence"] as const;
export type ProductDistrictId = (typeof PRODUCT_DISTRICTS)[number];

export const PRODUCT_DISTRICT_LABEL: Record<ProductDistrictId, string> = {
  "command-governance": "Command & Governance",
  "ai-automation": "AI & Automation",
  "infrastructure-engineering": "Infrastructure & Engineering",
  "business-operations": "Business Operations",
  "data-intelligence": "Data & Intelligence",
};

export const MODULE_TYPE_IDS = [
  "atlas-command-center",
  "identity-governance-tower",
  "agent-operations-center",
  "workflow-automation-plant",
  "model-intelligence-lab",
  "infrastructure-control-tower",
  "development-repository-hub",
  "security-operations-center",
  "business-operations-hq",
  "finance-analytics-tower",
  "growth-marketing-studio",
  "commerce-product-marketplace",
  "data-intelligence-center",
  "knowledge-repository",
  "observability-center",
  "integration-exchange",
] as const;
export type ModuleTypeId = (typeof MODULE_TYPE_IDS)[number];

/** available: works in Atlas today. planned: described only, nothing behind it yet. */
export type CapabilityState = "available" | "planned";

export interface ModuleCapability {
  id: string;
  label: string;
  state: CapabilityState;
  /** For an available capability: the existing code or view that provides it. Required, so the
   *  catalog can never claim a feature that nobody can point to. */
  evidence?: string;
}

/** Derived from the capabilities: available = all of them, partial = some, planned = none. */
export type ModuleAvailability = "available" | "partial" | "planned";

/** Observed health for a building. Unknown whenever telemetry cannot decide. */
export const MODULE_HEALTH = ["healthy", "warning", "critical", "unknown"] as const;
export type ModuleHealth = (typeof MODULE_HEALTH)[number];

/** Existing top-level Atlas views a module can point to (state.tsx View). */
export type ModuleView = "overview" | "agents" | "automations" | "repos" | "map" | "grid" | "activity" | "intel" | "usage" | "settings";

/**
 * A platform module type: the spec's AtlasBuildingModule, minus the per-building fields
 * (name, district, health, enabled), which belong to the instance below.
 */
export interface AtlasModuleType {
  id: ModuleTypeId;
  /** Contract version of this module definition. */
  version: string;
  name: string;
  productDistrict: ProductDistrictId;
  description: string;
  capabilities: ModuleCapability[];
  /** Data sources the module reads, each described by an integration contract (integrations.ts). */
  connectors: IntegrationId[];
  /** Existing views that show this module's data. Empty for planned modules. */
  views: ModuleView[];
  /** Existing guarded actions it exposes (src/actions). Never a new write path. */
  actions: string[];
  /** Permissions an action needs, enforced where the action runs, not here. */
  permissions: string[];
}

/** Where an instance's module type came from. */
export type ModuleProvenance = "declared" | "default" | "none";

/**
 * One building in a workspace. Identity, name and map district come from the existing catalog
 * project, so nothing on the map moves or is renamed.
 */
export interface BuildingInstance {
  /** The project id, the building's stable identity on the map. */
  id: string;
  projectId: string;
  /** The building's display name (project.name, or catalog/workspace/buildings.yaml for a landmark). */
  name: string;
  /** The organization the building belongs to, when the workspace records one. */
  organization?: string;
  /** The map district it stands in today. */
  districtId: DistrictId;
  /** The platform module it is an occurrence of; null for a personal building with no module. */
  moduleType: ModuleTypeId | null;
  moduleProvenance: ModuleProvenance;
  /** False when the module is planned only, the workspace is not entitled to it, or the project is retired. */
  enabled: boolean;
  /** Placeholder until Phase 3 aggregates telemetry: always "unknown" when built from the catalog. */
  health: ModuleHealth;
}
