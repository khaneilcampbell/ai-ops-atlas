import { ESSENTIAL_ROLES, isArchived, isInactive, roleOf, SKILL_OF } from "../../catalog/essentialRoles";
import { ownership } from "../../catalog/ownership";
import { isAiAgent } from "../../catalog/roles";
import type { Agent } from "../../catalog/types";
import { identityFor } from "../../registry/identity";
import { needsYou } from "./teamModel";
import type { RegistryEntry } from "../../registry/registry";
import type { AutonomyLevel, Operational } from "../../registry/types";

// The Agents > Roster view (2026-11-24): one sortable row per current AI agent. Every column is
// read from the catalog or observed runs; a value Atlas doesn't have stays null, never estimated.

export type RosterFilter = "all" | "needs" | "verified" | "unverified" | "inactive";
export type RosterSort = "name" | "role" | "health" | "automations" | "verified";

export interface RosterRow {
  id: string;
  name: string;
  /** The persona name (Yusuf Demir), or the agent name when it has none. */
  person: string;
  role: string;
  /** Skills that run inside this agent (Product Lab research steps). They are part of this agent, not
   *  agents of their own, so they get no row; the lead row lists them instead. */
  skills: string[];
  operational: Operational;
  inactive: boolean;
  automations: { live: number; paused: number; manual: number };
  lastVerifiedAt: string | null;
  autonomy: AutonomyLevel | null;
  spendUsd: number | null;
  /** Items waiting on Khaneil for this agent (needsYou: failing, drafts to publish, inactive). */
  needs: number;
}

const HEALTH_ORDER: Operational[] = ["failing", "unknown", "configured", "planned", "verified"];
const isPaused = (a: Pick<Agent, "status" | "trigger">) => a.status === "paused";

export function buildRoster(agents: Agent[], entries: ReadonlyMap<string, RegistryEntry>): RosterRow[] {
  const roles = roleOf(agents);
  const roleName = new Map(ESSENTIAL_ROLES.map((r) => [r.id, r.name]));
  const parentOf = SKILL_OF;
  const owned = ownership({ agents }).owned;
  const waiting = new Map<string, number>();
  for (const n of needsYou(agents, (id) => entries.get(id)?.operational)) waiting.set(n.agent, (waiting.get(n.agent) ?? 0) + 1);
  const current = agents.filter((a) => isAiAgent(a) && !isArchived(a));
  const ids = new Set(current.map((a) => a.id));
  const skillsOf = new Map<string, string[]>();
  for (const a of current) {
    const lead = parentOf.get(a.id);
    if (lead && ids.has(lead)) skillsOf.set(lead, [...(skillsOf.get(lead) ?? []), a.name]);
  }
  return current
    .filter((a) => !(parentOf.has(a.id) && ids.has(parentOf.get(a.id)!)))
    .map((a) => {
      const e = entries.get(a.id);
      const autos = owned.get(a.id) ?? [];
      const automations = {
        live: autos.filter((x) => x.status === "active").length,
        paused: autos.filter(isPaused).length,
        manual: autos.filter((x) => x.status !== "active" && !isPaused(x)).length,
      };
      const operational = e?.operational ?? "unknown";
      const inactive = isInactive(a);
      return {
        id: a.id,
        name: a.name,
        person: identityFor(a.id, agents).name,
        role: roleName.get(roles.get(a.id) ?? "") ?? "No owning role",
        skills: skillsOf.get(a.id) ?? [],
        operational,
        inactive,
        automations,
        lastVerifiedAt: e?.telemetry.lastVerifiedRun?.at ?? null,
        autonomy: e?.profile.governance.autonomy ?? null,
        spendUsd: e?.telemetry.monthSpendUsd ?? null,
        needs: waiting.get(a.id) ?? 0,
      };
    });
}

export function filterRoster(rows: RosterRow[], f: RosterFilter, query = ""): RosterRow[] {
  const q = query.trim().toLowerCase();
  return rows.filter((r) => {
    if (q && !`${r.person} ${r.name} ${r.role} ${r.id} ${r.skills.join(" ")}`.toLowerCase().includes(q)) return false;
    if (f === "needs") return r.needs > 0;
    if (f === "verified") return r.operational === "verified";
    if (f === "unverified") return r.operational !== "verified";
    if (f === "inactive") return r.inactive;
    return true;
  });
}

export function rosterCounts(rows: RosterRow[]): Record<RosterFilter, number> {
  return { all: rows.length, needs: rows.reduce((n, r) => n + r.needs, 0), verified: filterRoster(rows, "verified").length, unverified: filterRoster(rows, "unverified").length, inactive: filterRoster(rows, "inactive").length };
}

const total = (r: RosterRow) => r.automations.live + r.automations.paused + r.automations.manual;

/** Sorted rows. */
export function sortRoster(rows: RosterRow[], by: RosterSort, desc = false): RosterRow[] {
  const cmp = (a: RosterRow, b: RosterRow): number => {
    switch (by) {
      case "role": return a.role.localeCompare(b.role) || a.person.localeCompare(b.person);
      case "health": return HEALTH_ORDER.indexOf(a.operational) - HEALTH_ORDER.indexOf(b.operational) || a.person.localeCompare(b.person);
      case "automations": return total(b) - total(a) || a.person.localeCompare(b.person);
      case "verified": return (b.lastVerifiedAt ?? "").localeCompare(a.lastVerifiedAt ?? "") || a.person.localeCompare(b.person);
      default: return a.person.localeCompare(b.person);
    }
  };
  return [...rows].sort((a, b) => (desc ? -cmp(a, b) : cmp(a, b)));
}
