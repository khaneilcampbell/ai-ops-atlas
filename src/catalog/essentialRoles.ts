import { isAiAgent, worksThroughAutomations } from "./roles";
import type { Agent, Project } from "./types";
import { moduleType } from "../modules/catalog";
import type { Operational } from "../registry/types";

// The Agents tab groups every entry under one of a few essential roles (Khaneil, 2026-11-17). A role
// is an organizational grouping for the directory only: it is not a new runtime, never runs anything
// and changes no catalog record. Each role reuses an existing agent id as its anchor. Agents join a
// role through ROLE_AGENTS below; an automation follows its `owned_by` agent, so it has exactly one
// owner. Grouping lives in code, so a registry refresh or sheet sync cannot undo it.

export interface EssentialRole {
  id: string;
  name: string;
  purpose: string;
  /** Existing agent ids in this role, anchor (the role's stable identity) first. */
  agents: string[];
}

export const ESSENTIAL_ROLES: EssentialRole[] = [
  { id: "agent-operations-lead", name: "Atlas Operations Lead", purpose: "Agent registry, new-agent proposals and coordination of goals.", agents: ["agent-operations-lead"] },
  { id: "atlas-release-manager", name: "Engineering & Release Lead", purpose: "Engineering reviews, documentation and release preparation.", agents: ["atlas-release-manager", "atlas-production-coordinator", "atlas-release-coordinator", "atlas-engineering-review", "repo-intelligence", "documentation-lead"] },
  { id: "atlas-health-monitor", name: "Health & Security Lead", purpose: "Production health, failures and operational security findings.", agents: ["atlas-health-monitor", "benjaire-ops-monitor"] },
  { id: "benjaire-product-lab", name: "Product Research Lead", purpose: "Product Lab research, competitors, customer insights, scoring and brief writing.", agents: ["benjaire-product-lab", "benjaire-product-lab-research", "benjaire-product-lab-competitors", "benjaire-product-lab-customers", "benjaire-product-lab-scoring", "benjaire-product-lab-brief"] },
  { id: "benjaire-inquiry-manager", name: "Client Operations Lead", purpose: "Inquiries, reply preparation, reminders and digests.", agents: ["benjaire-inquiry-manager"] },
  { id: "commerce-operations-manager", name: "Commerce Operations Lead", purpose: "Product publishing, fulfillment and sales reporting.", agents: ["commerce-operations-manager", "benjaire-shop-manager"] },
  { id: "development-hub-lead", name: "Development & Portfolio Lead", purpose: "Development opportunities and portfolio work.", agents: ["development-hub-lead", "site-builder", "github-profile-manager"] },
  { id: "soc-detection-lead", name: "Security Lab Specialist", purpose: "On-demand detection and lab work.", agents: ["soc-detection-lead"] },
];

type Item = Pick<Agent, "id" | "status" | "ownedBy" | "trigger" | "registry">;

export const isArchived = (a: Pick<Agent, "status">) => a.status === "retired";
/** Paused, draft or planned: listed apart so a role never looks busier than it is. */
export const isInactive = (a: Item) => !isArchived(a) && (a.status === "paused" || a.registry?.classification?.type === "F" || /\bdraft\b|until it is published/i.test(a.trigger ?? ""));

/** Role id for each catalog entry; entries with no role (archived ones included) are absent. */
export function roleOf(items: Item[]): Map<string, string> {
  const byAgent = new Map(ESSENTIAL_ROLES.flatMap((r) => r.agents.map((id) => [id, r.id] as const)));
  const out = new Map<string, string>();
  for (const a of items) {
    const role = isAiAgent(a) ? byAgent.get(a.id) : a.ownedBy ? byAgent.get(a.ownedBy) : undefined;
    if (role && !isArchived(a)) out.set(a.id, role);
  }
  return out;
}

export interface RoleDirectory {
  /** Current entries per role id, in catalog order. */
  members: Map<string, string[]>;
  inactive: string[];
  archived: string[];
  /** Current entries no role claims: shown as "No owning role" so the gap is visible. */
  unassigned: string[];
  counts: { roles: number; automations: number; aiAgents: number; inactive: number; archived: number };
}

/** Splits every entry into exactly one place: a role, Inactive, Archived or Unassigned. */
export function roleDirectory(items: Item[]): RoleDirectory {
  const roles = roleOf(items);
  const members = new Map(ESSENTIAL_ROLES.map((r) => [r.id, [] as string[]]));
  const out: RoleDirectory = { members, inactive: [], archived: [], unassigned: [], counts: { roles: ESSENTIAL_ROLES.length, automations: 0, aiAgents: 0, inactive: 0, archived: 0 } };
  for (const a of items) {
    if (isArchived(a)) out.archived.push(a.id);
    else if (isInactive(a)) out.inactive.push(a.id);
    else if (roles.has(a.id)) members.get(roles.get(a.id)!)!.push(a.id);
    else out.unassigned.push(a.id);
    if (!isArchived(a)) out.counts[isAiAgent(a) ? "aiAgents" : "automations"]++;
  }
  out.counts.inactive = out.inactive.length;
  out.counts.archived = out.archived.length;
  return out;
}

/** How a member is labelled: a deterministic workflow is always an Automation. */
export function memberKind(a: Pick<Agent, "runtime" | "registry">): "AI runtime" | "Coordinates automations" | "Planned" | "Automation" {
  if (!isAiAgent(a)) return "Automation";
  if (a.registry?.classification?.type === "F") return "Planned";
  return worksThroughAutomations(a) ? "Coordinates automations" : "AI runtime";
}

const STALE_MS = 35 * 864e5;
export interface Activity { verified: number; failing: number; unknown: number; stale: number; noEvidence: number }

/** Activity from observed runs only. An enabled schedule alone counts as no evidence. */
export function roleActivity(entries: { operational: Operational; lastVerifiedAt: string | null }[], now = Date.now()): Activity {
  const act: Activity = { verified: 0, failing: 0, unknown: 0, stale: 0, noEvidence: 0 };
  for (const e of entries) {
    if (e.operational === "failing") act.failing++;
    else if (e.operational === "unknown") act.unknown++;
    else if (e.operational !== "verified") act.noEvidence++;
    else if (e.lastVerifiedAt && now - Date.parse(e.lastVerifiedAt) > STALE_MS) act.stale++;
    else act.verified++;
  }
  return act;
}

/** Where an entry works: its project's building and that building's module, both read from the
 *  catalog and never changed by its role. Module is null where the building houses none. */
export function placement(a: Pick<Agent, "projectId">, projects: Pick<Project, "id" | "name" | "module">[]) {
  const p = projects.find((x) => x.id === a.projectId);
  return { building: p?.name ?? null, module: moduleType(p?.module)?.name ?? null };
}
