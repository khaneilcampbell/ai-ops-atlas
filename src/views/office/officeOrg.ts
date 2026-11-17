import type { ExecutionRecord } from "../../registry/types";
import type { AgentProfile } from "../../registry/profile";
import type { AgentPlaces, Place } from "../../catalog/agentPlaces";
import { RUNTIME_LABEL, type Runtime, type RuntimeState, type Workstation } from "./model";

/**
 * How an office reads as an organization, and what the hologram over a desk says. Pure, so the
 * rules are tested: everything shown comes from the desk plan, the verified runtime state and run
 * history, and the agent's registry profile. Nothing here invents a run, a rate or a status.
 */

export const TIER_LABEL: Record<Workstation["tier"], string> = {
  central: "Central operations",
  coordinator: "Coordinators",
  specialized: "Specialists",
};

export const TEAM_LABEL: Record<Workstation["zone"], string> = {
  coordination: "Coordination",
  research: "Research",
  production: "Production",
  quality: "Quality review",
};

/** States worth naming on a team sign, in the order they are named. Calm states are left out. */
const SIGN_STATES: RuntimeState[] = ["working", "awaiting", "failed"];

export interface OrgBand {
  tier: Workstation["tier"];
  label: string;
  count: number;
  /** Desk-centre extent of the band in the room, for its floor outline and sign. */
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  /** For example "1 running · 1 failed"; null when nothing needs attention. */
  activity: string | null;
}

/** One band per role tier, in the plan's own order (central, coordinators, specialists). */
export function orgBands(desks: { ws: Workstation; runtime: Pick<Runtime, "state"> }[]): OrgBand[] {
  const out: OrgBand[] = [];
  for (const tier of Object.keys(TIER_LABEL) as Workstation["tier"][]) {
    const mine = desks.filter((d) => d.ws.tier === tier);
    if (!mine.length) continue;
    const xs = mine.map((d) => d.ws.x);
    const zs = mine.map((d) => d.ws.z);
    const counts = SIGN_STATES.map((s) => [s, mine.filter((d) => d.runtime.state === s).length] as const).filter(([, n]) => n > 0);
    out.push({
      tier,
      label: TIER_LABEL[tier],
      count: mine.length,
      minX: Math.min(...xs),
      maxX: Math.max(...xs),
      minZ: Math.min(...zs),
      maxZ: Math.max(...zs),
      activity: counts.length ? counts.map(([s, n]) => `${n} ${RUNTIME_LABEL[s].toLowerCase()}`).join(" · ") : null,
    });
  }
  return out;
}

/** Groups any list by tier, in tier order, for the roster. */
export function byTier<T>(items: T[], tierOf: (item: T) => Workstation["tier"]): { tier: Workstation["tier"]; label: string; items: T[] }[] {
  return (Object.keys(TIER_LABEL) as Workstation["tier"][])
    .map((tier) => ({ tier, label: TIER_LABEL[tier], items: items.filter((i) => tierOf(i) === tier) }))
    .filter((g) => g.items.length > 0);
}

export type RunMark = "success" | "failure" | "running" | "other";

export interface HologramData {
  name: string;
  /** "Production team · Specialists" */
  team: string;
  state: RuntimeState;
  stateLabel: string;
  reason: string;
  /** Where the state came from, or "Not connected" when no source is declared. */
  source: string;
  /** Up to RUN_SLOTS recent runs, oldest first, exactly as observed. Empty when none. */
  runs: RunMark[];
  /** "3 of 4 recent runs succeeded", or the honest reason there is no figure. */
  runsCaption: string;
  /** Share of completed runs shown that succeeded, 0 to 100; null with no completed run. */
  successPct: number | null;
  /** The newest run, as observed. */
  latest: { label: string; at: string; result: RunMark } | null;
  /** Up to three declared responsibilities. */
  tasks: string[];
  /** The declared objective, else the mission purpose, else null. */
  goal: string | null;
  autonomy: number | null;
  /** Where it lives and works (agentPlaces.ts); null when not given. Placement, never activity. */
  home: Place | null;
  work: Place | null;
}

export const RUN_SLOTS = 12;

export function hologramData(o: {
  name: string;
  ws: Pick<Workstation, "tier" | "zone">;
  runtime: Runtime;
  history: ExecutionRecord[];
  profile: Pick<AgentProfile, "responsibilities" | "goals" | "mission" | "governance">;
  places?: AgentPlaces;
}): HologramData {
  const recent = o.history.slice(0, RUN_SLOTS);
  const runs = recent.map((e) => e.result).reverse();
  const success = recent.filter((e) => e.result === "success").length;
  const completed = success + recent.filter((e) => e.result === "failure").length;
  const successPct = completed ? Math.round((success / completed) * 100) : null;
  const runsCaption = !o.runtime.source
    ? "Not connected: no run data"
    : !recent.length
      ? "No runs observed yet"
      : completed
        ? `${success} of ${completed} recent ${completed === 1 ? "run" : "runs"} succeeded`
        : `${recent.length} recent ${recent.length === 1 ? "run" : "runs"}, none completed`;
  const top = o.history[0];
  const goal = o.profile.goals.objective?.trim() || o.profile.mission.purpose?.trim() || null;
  return {
    name: o.name,
    team: `${TEAM_LABEL[o.ws.zone]} team · ${TIER_LABEL[o.ws.tier]}`,
    state: o.runtime.state,
    stateLabel: RUNTIME_LABEL[o.runtime.state],
    reason: o.runtime.reason,
    source: o.runtime.source ?? "Not connected",
    runs,
    runsCaption,
    successPct,
    latest: top ? { label: top.label, at: top.at, result: top.result } : null,
    tasks: o.profile.responsibilities.tasks.filter((t) => t.trim()).slice(0, 3),
    goal,
    autonomy: o.profile.governance.autonomy ?? null,
    home: o.places?.home ?? null,
    work: o.places?.work ?? null,
  };
}
