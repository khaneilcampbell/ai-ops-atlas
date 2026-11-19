import * as yaml from "js-yaml";
import type { ManifestIssue } from "../catalog/types";

// Building display names for the buildings the map draws itself (landmarks, Financial District
// towers, stations). A building has three separate things:
// - its stable id: the map selection key ("service:financial:banks"). Never renamed.
// - its display name: what the plaque, inspector, navigation and search show.
// - its organization: who it belongs to ("Bayvale Bank"), kept as metadata.
// Names come from catalog/workspace/buildings.yaml, so a workspace renames a building without
// editing code. The map's own name constants stay as they are, because interiors, saved routes
// and visual specs still use them as keys. Catalog project buildings are renamed in their own
// manifest (`project.name`, `organization`, `former_names`).

export interface BuildingName {
  key: string;
  displayName: string;
  organization?: string;
  /** Earlier names: search aliases only, never shown as the building's name. */
  formerNames: string[];
}

export const BUILDINGS_SCHEMA = "atlas/buildings-v1";
const KEY_RE = /^(service|project):[a-z0-9][a-z0-9:-]*$/;

/** Parses the workspace's building names. Problems are reported in `issues`, never thrown. */
export function parseBuildingNames(file: string, text: string, issues: ManifestIssue[]): Record<string, BuildingName> {
  const fail = (message: string) => issues.push({ file, message });
  let doc: unknown;
  try {
    doc = yaml.load(text, { schema: yaml.CORE_SCHEMA });
  } catch (e) {
    fail(`file: invalid YAML (${(e as Error).message.split("\n")[0]})`);
    return {};
  }
  const root = doc && typeof doc === "object" ? (doc as Record<string, unknown>) : {};
  if (root.schema !== BUILDINGS_SCHEMA) fail(`schema: must be "${BUILDINGS_SCHEMA}"`);
  const buildings = root.buildings;
  if (!buildings || typeof buildings !== "object" || Array.isArray(buildings)) {
    fail("buildings: expected a mapping of building ids");
    return {};
  }
  const out: Record<string, BuildingName> = {};
  for (const [key, raw] of Object.entries(buildings as Record<string, unknown>)) {
    if (!KEY_RE.test(key)) { fail(`buildings.${key}: use a building id such as "service:atlas-marketplace"`); continue; }
    const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
    const text = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
    const displayName = text(o.display_name);
    if (!displayName) { fail(`buildings.${key}.display_name: is required`); continue; }
    const organization = text(o.organization);
    const formerNames = Array.isArray(o.former_names) ? o.former_names.map(text).filter((n): n is string => !!n) : [];
    out[key] = { key, displayName, ...(organization ? { organization } : {}), formerNames };
  }
  return out;
}

const files = import.meta.glob("../../catalog/workspace/buildings.yaml", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
const issues: ManifestIssue[] = [];
/** This workspace's building names, by building id. */
export const BUILDING_NAMES: Readonly<Record<string, BuildingName>> = Object.assign({}, ...Object.values(files).map((t) => parseBuildingNames("workspace/buildings.yaml", t, issues)));
export const buildingNameIssues: readonly ManifestIssue[] = issues;

/** The map selection key for a `service` selection id ("financial:banks" -> "service:financial:banks"). */
export const serviceKey = (id: string) => `service:${id}`;

/**
 * The name to show for a building: its configured display name, or `fallback` (the map's own
 * name) when the workspace has not renamed it. Always pass the building's own name as fallback,
 * never other text, so an unconfigured building looks exactly as it did.
 */
export function buildingDisplayName(key: string, fallback: string, names: Readonly<Record<string, BuildingName>> = BUILDING_NAMES): string {
  return names[key]?.displayName ?? fallback;
}

/** The organization a building belongs to, when the workspace records one. */
export function buildingOrganization(key: string, names: Readonly<Record<string, BuildingName>> = BUILDING_NAMES): string | undefined {
  return names[key]?.organization;
}

/** Earlier names a building is still found by in search. */
export function buildingAliases(key: string, names: Readonly<Record<string, BuildingName>> = BUILDING_NAMES): string[] {
  return names[key]?.formerNames ?? [];
}

/** The current display name for text that is exactly a renamed building's earlier name, else the text. */
export function currentBuildingName(text: string, names: Readonly<Record<string, BuildingName>> = BUILDING_NAMES): string {
  return Object.values(names).find((n) => n.formerNames.includes(text))?.displayName ?? text;
}
