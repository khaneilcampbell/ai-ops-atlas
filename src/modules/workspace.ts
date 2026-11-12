import * as yaml from "js-yaml";
import type { ManifestIssue } from "../catalog/types";
import { isModuleType } from "./catalog";
import type { BuildingInstance, ModuleTypeId } from "./types";

// The workspace: the business or person using Atlas, the module types they may use, and which
// map-drawn landmark houses which module. It is read from catalog/workspace/workspace.yaml so
// another workspace is set up by editing that file, never code (Phase 3, docs/modules.md "Set up
// another workspace"). Module types (catalog.ts) stay generic; display names stay in
// buildings.yaml (names.ts); catalog project buildings pick their module in their own manifest.

/**
 * A landmark building that is not a catalog project (the map draws it, selected as
 * `service:<id>`) and the platform module it houses. `name` is the map's own name for the
 * building (AGENCY_NAME, financialBrand(...).name and so on), which modules.test.ts checks stays
 * in step with the map so nothing is renamed or moved by accident. What the building is called on
 * screen comes from buildings.yaml.
 */
export interface LandmarkAssignment {
  id: string;
  name: string;
  moduleType: ModuleTypeId;
  /** The catalog project whose repository and workplace agents this building operates with. */
  project?: string;
  /** That project's agents that operate this building without a desk in it (catalog agent ids). */
  agents?: string[];
}

/**
 * A workspace: the business or person using Atlas, its own landmark module assignments, and the
 * module types it may use. Entitlements only decide what the page shows as switched on. They are
 * not a security boundary: protected actions are authorized where they run (the Rust shell or the
 * site's server functions).
 */
export interface AtlasWorkspace {
  id: string;
  name: string;
  landmarks: readonly LandmarkAssignment[];
  /** Module types this workspace may use, or "all". */
  entitlements: readonly ModuleTypeId[] | "all";
}

export const WORKSPACE_SCHEMA = "atlas/workspace-v1";
const KEY_RE = /^service:[a-z0-9][a-z0-9:-]*$/;
const ID_RE = /^[a-z0-9][a-z0-9-]*$/;

/** A workspace with nothing in it, used when the file cannot be read at all. */
const EMPTY: AtlasWorkspace = { id: "workspace", name: "Workspace", landmarks: [], entitlements: "all" };

/**
 * Parses a workspace file. Problems are reported in `issues`, never thrown: a bad landmark is
 * skipped and the rest still load, so one typo never empties the map's modules.
 */
export function parseWorkspace(file: string, text: string, issues: ManifestIssue[]): AtlasWorkspace {
  const fail = (message: string) => issues.push({ file, message });
  let doc: unknown;
  try {
    doc = yaml.load(text, { schema: yaml.CORE_SCHEMA });
  } catch (e) {
    fail(`file: invalid YAML (${(e as Error).message.split("\n")[0]})`);
    return EMPTY;
  }
  const root = doc && typeof doc === "object" ? (doc as Record<string, unknown>) : {};
  if (root.schema !== WORKSPACE_SCHEMA) fail(`schema: must be "${WORKSPACE_SCHEMA}"`);
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);

  const ws = root.workspace && typeof root.workspace === "object" ? (root.workspace as Record<string, unknown>) : {};
  const id = str(ws.id);
  if (!id || !ID_RE.test(id)) fail("workspace.id: is required (lower-case letters, digits and dashes)");
  const name = str(ws.name);
  if (!name) fail("workspace.name: is required");
  let entitlements: AtlasWorkspace["entitlements"] = "all";
  if (ws.entitlements !== undefined && ws.entitlements !== "all") {
    if (!Array.isArray(ws.entitlements)) {
      fail('workspace.entitlements: use "all" or a list of module type ids');
    } else {
      const ok: ModuleTypeId[] = [];
      for (const e of ws.entitlements) {
        if (isModuleType(e)) ok.push(e);
        else fail(`workspace.entitlements: "${String(e)}" is not a module type`);
      }
      entitlements = ok;
    }
  }

  const landmarks: LandmarkAssignment[] = [];
  const raw = root.landmarks;
  if (raw !== undefined && (!raw || typeof raw !== "object" || Array.isArray(raw))) {
    fail("landmarks: expected a mapping of building ids");
  } else if (raw) {
    for (const [key, v] of Object.entries(raw as Record<string, unknown>)) {
      if (!KEY_RE.test(key)) { fail(`landmarks.${key}: use a landmark id such as "service:atlas-marketplace"`); continue; }
      const o = v && typeof v === "object" ? (v as Record<string, unknown>) : {};
      const mapName = str(o.map_name);
      if (!mapName) { fail(`landmarks.${key}.map_name: is required (the map's own name for the building)`); continue; }
      if (!isModuleType(o.module)) { fail(`landmarks.${key}.module: "${String(o.module ?? "")}" is not a module type`); continue; }
      const project = o.project === undefined ? undefined : str(o.project);
      if (o.project !== undefined && (!project || !ID_RE.test(project))) { fail(`landmarks.${key}.project: use a catalog project id such as "benjaire-site"`); continue; }
      const agents = o.agents === undefined ? undefined : Array.isArray(o.agents) ? o.agents.map(str) : null;
      if (agents !== undefined && (!project || !agents || !agents.length || !agents.every((a) => a && ID_RE.test(a)))) { fail(`landmarks.${key}.agents: list the catalog agent ids of its project that operate it, and set project`); continue; }
      landmarks.push({ id: key.slice("service:".length), name: mapName, moduleType: o.module, ...(project ? { project } : {}), ...(agents?.length ? { agents: agents as string[] } : {}) });
    }
  }
  return { id: id ?? EMPTY.id, name: name ?? EMPTY.name, landmarks, entitlements };
}

const files = import.meta.glob("../../catalog/workspace/workspace.yaml", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
const issues: ManifestIssue[] = [];
const text = Object.values(files)[0];
/** This Atlas install's workspace, from catalog/workspace/workspace.yaml. */
export const WORKSPACE: AtlasWorkspace = text === undefined ? (issues.push({ file: "workspace/workspace.yaml", message: "file: missing" }), EMPTY) : parseWorkspace("workspace/workspace.yaml", text, issues);
export const workspaceIssues: readonly ManifestIssue[] = issues;

/** The landmark module assignments of this workspace (kept as a name for the existing callers and tests). */
export const LANDMARK_MODULES: readonly LandmarkAssignment[] = WORKSPACE.landmarks;

export function isEntitled(workspace: Pick<AtlasWorkspace, "entitlements">, type: ModuleTypeId | null | undefined): boolean {
  return !!type && (workspace.entitlements === "all" || workspace.entitlements.includes(type));
}

export type LandmarkInstance = Omit<BuildingInstance, "districtId" | "projectId"> & {
  districtId: null;
  projectId: null;
  /** The catalog project this landmark operates with, and the workplace name its agents sit in. */
  linked?: { projectId: string; workplace: string; agents?: string[] };
};
