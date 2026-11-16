import { isAiAgent, servicesOf } from "./roles";
import { districtOf } from "./organization";
import type { Agent, Project } from "./types";

// Tool Facilities: the hierarchy District → primary building → Tool Facility → tool or integration
// (Khaneil, 2026-11-16). A facility exists only where a registered item's manifest names the tool
// among its `registry.responsibilities.tools` (or, for n8n, links an n8n workflow), so nothing is
// invented. One integration can back facilities at several buildings: they all point at the same
// Integration Center entry (src/product/integrations.ts) and never hold a credential of their own.
//
// Two sources draw them on the map:
// - "tool-office": the district tool offices the layout already places (roles.ts SERVICES). They
//   keep their place and key, so no building, road or district moves.
// - "satellite": the integrations those offices don't cover yet (GitHub, Claude). They stand on free
//   ground in the parent's district (views/map3d/toolFacilityPlan.ts) and show only when the map's
//   Tool facilities toggle is on.

/** Default facility size: half the parent building's width, depth and height. */
export const FACILITY_SCALE = 0.5;

export type FacilityKind = "repository" | "ai-model" | "automation" | "payments" | "hosting" | "storefront" | "design" | "search" | "logs";

/** Integration Center status, mapped to what a facility may claim. */
export type FacilityStatus = "connected" | "configured" | "degraded" | "disconnected" | "unavailable" | "unknown";

export interface ToolFacility {
  /** Stable id: `<projectId>:<toolId>`. */
  id: string;
  /** Map selection key. Tool offices keep their existing `service:<project>:<service>` key. */
  key: string;
  source: "tool-office" | "satellite";
  /** The parent building's map key (`project:<id>`). */
  parentBuildingId: string;
  projectId: string;
  districtId: string;
  /** Integration Center id when Atlas has one for this tool, otherwise null (status stays unknown). */
  integrationId: string | null;
  toolId: string;
  /** What the building does, shown on the map. Never a vendor's brand (see roles.ts Service). */
  name: string;
  /** The real tool the manifests name, shown as plain text in the panel. */
  vendor: string;
  kind: FacilityKind;
  /** AI agents (classification A or F) whose manifests name the tool. */
  associatedAgentIds: string[];
  /** Automations and workflows whose manifests name the tool. */
  associatedWorkflowIds: string[];
  /** n8n workflow pages linked from those items, labelled with "n8n" in their manifests. */
  workflowLinks: { label: string; url: string; agentId: string }[];
  scaleFactor: number;
}

interface SatelliteRule {
  toolId: string;
  integrationId: string;
  name: string;
  vendor: string;
  kind: FacilityKind;
  /** Matches a manifest tool entry. */
  re: RegExp;
}

/**
 * Integrations Atlas has an Integration Center entry for that no tool office covers. "Claude Code"
 * is a coding tool someone runs, not Atlas's Claude integration, so it does not count.
 */
export const SATELLITE_RULES: readonly SatelliteRule[] = [
  { toolId: "github", integrationId: "github", name: "Repository Office", vendor: "GitHub", kind: "repository", re: /\bgit(hub)?\b/i },
  { toolId: "anthropic", integrationId: "anthropic", name: "AI Model Lab", vendor: "Anthropic (Claude)", kind: "ai-model", re: /\banthropic\b|\bclaude\b(?!\s+code)/i },
  { toolId: "n8n", integrationId: "n8n", name: "Automation Works", vendor: "n8n", kind: "automation", re: /\bn8n\b/i },
  { toolId: "cloudflare", integrationId: "cloudflare", name: "Edge Office", vendor: "Cloudflare", kind: "hosting", re: /\bcloudflare\b/i },
  { toolId: "stripe", integrationId: "stripe", name: "Payments Office", vendor: "Stripe", kind: "payments", re: /\bstripe\b/i },
];

/** Tool offices (roles.ts SERVICES) and the Integration Center entry behind each, where there is one. */
const OFFICE_INTEGRATION: Record<string, { integrationId: string | null; kind: FacilityKind }> = {
  stripe: { integrationId: "stripe", kind: "payments" },
  cloudflare: { integrationId: "cloudflare", kind: "hosting" },
  n8n: { integrationId: "n8n", kind: "automation" },
  shopify: { integrationId: null, kind: "storefront" },
  canva: { integrationId: null, kind: "design" },
  serper: { integrationId: null, kind: "search" },
  splunk: { integrationId: null, kind: "logs" },
};

const n8nLinks = (a: Agent) => (a.links ?? []).filter((l) => /\bn8n\b/i.test(l.label) && /^https?:\/\//.test(l.url));

/** Does this item use the tool: named among its tools, or (n8n only) it links an n8n workflow. */
function uses(a: Agent, rule: Pick<SatelliteRule, "toolId" | "re">) {
  return (a.registry?.responsibilities?.tools ?? []).some((t) => rule.re.test(t)) || (rule.toolId === "n8n" && n8nLinks(a).length > 0);
}

function split(users: Agent[]) {
  return {
    associatedAgentIds: users.filter(isAiAgent).map((a) => a.id),
    associatedWorkflowIds: users.filter((a) => !isAiAgent(a)).map((a) => a.id),
    workflowLinks: users.flatMap((a) => n8nLinks(a).map((l) => ({ label: l.label, url: l.url, agentId: a.id }))),
  };
}

export const facilityKey = (projectId: string, toolId: string) => `service:facility:${projectId}:${toolId}`;

/**
 * Every Tool Facility of one project building, tool offices first (in the layout's order), then
 * satellites in SATELLITE_RULES order. Retired items no longer use anything, so they don't count.
 * `onMap` is false for projects with no building: they get no facilities.
 */
export function projectFacilities(project: Project, agents: Agent[], onMap = true): ToolFacility[] {
  if (!onMap) return [];
  const mine = agents.filter((a) => a.projectId === project.id && a.status !== "retired");
  const districtId = districtOf(project, agents).value;
  const base = { parentBuildingId: `project:${project.id}`, projectId: project.id, districtId, scaleFactor: FACILITY_SCALE };
  // The layout draws an office for every service any of the project's items name (retired too); a
  // facility needs a current user, so an office whose users all retired is left out here.
  const offices: ToolFacility[] = servicesOf(mine).map((s) => ({
    ...base,
    id: `${project.id}:${s.id}`,
    key: `service:${project.id}:${s.id}`,
    source: "tool-office",
    integrationId: OFFICE_INTEGRATION[s.id]?.integrationId ?? null,
    toolId: s.id,
    name: s.name,
    vendor: s.vendor,
    kind: OFFICE_INTEGRATION[s.id]?.kind ?? "automation",
    ...split(mine.filter((a) => uses(a, { toolId: s.id, re: SATELLITE_RULES.find((r) => r.toolId === s.id)?.re ?? new RegExp(`\\b${s.id}\\b`, "i") }))),
  }));
  const covered = new Set(offices.map((o) => o.toolId));
  const satellites: ToolFacility[] = SATELLITE_RULES.filter((r) => !covered.has(r.toolId)).flatMap((r) => {
    const users = mine.filter((a) => uses(a, r));
    if (!users.length) return [];
    return [{ ...base, id: `${project.id}:${r.toolId}`, key: facilityKey(project.id, r.toolId), source: "satellite" as const, integrationId: r.integrationId, toolId: r.toolId, name: r.name, vendor: r.vendor, kind: r.kind, ...split(users) }];
  });
  return [...offices, ...satellites];
}

/** Every project building's facilities, in catalog order. */
export function toolFacilities(projects: Project[], agents: Agent[], offMap: ReadonlySet<string> = new Set()): ToolFacility[] {
  return projects.flatMap((p) => projectFacilities(p, agents, !offMap.has(p.id)));
}

/** A facility by its selection id (`facility:<project>:<tool>` or `<project>:<service>`). */
export function facilityById(facilities: ToolFacility[], selectionId: string): ToolFacility | undefined {
  const id = selectionId.startsWith("facility:") ? selectionId.slice(9) : selectionId;
  return facilities.find((f) => f.id === id);
}

export const FACILITY_STATUS_LABEL: Record<FacilityStatus, string> = {
  connected: "Connected · verified",
  configured: "Configured · not verified",
  degraded: "Degraded",
  disconnected: "Disconnected",
  unavailable: "Unavailable here",
  unknown: "Unknown",
};

/**
 * What a facility may claim from its Integration Center state. Only a real authenticated check
 * makes it "connected"; a key that is set but unchecked is "configured". Not set up yet, or still
 * checking, is "unknown" rather than a failure, and a tool Atlas has no integration for stays unknown.
 */
export function facilityStatus(state: { status: string; verifiedAt: string | null } | undefined): FacilityStatus {
  if (!state) return "unknown";
  switch (state.status) {
    case "connected":
      return state.verifiedAt ? "connected" : "configured";
    case "degraded":
      return "degraded";
    case "disconnected":
      return "disconnected";
    case "unsupported":
      return "unavailable";
    default:
      return "unknown";
  }
}
