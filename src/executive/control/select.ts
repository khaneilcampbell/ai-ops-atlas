import { AGENT_GRANTS, capability, type Capability } from "../../intelligence/capabilities";
import { RUN_LIMITS, type Autonomy } from "./types";

// Deterministic agent selection. Candidates come from the Agent Registry (the catalog on main) and
// the capability grants in src/intelligence/capabilities.ts; workload and reliability come from the
// Atlas database. A model may one day suggest an agent, but this code decides, and the same inputs
// always give the same answer. No eligible agent means the task is BLOCKED with the reason.

export interface RosterAgent {
  id: string;
  name: string;
  /** Catalog status: active, idle, paused, planned, retired... */
  status: string;
  /** Building (catalog project id) the agent works in. */
  projectId: string;
}

export interface AgentStats {
  /** Tasks the agent has dispatched or running now. */
  active: number;
  /** Finished runs in the last 30 days. */
  succeeded: number;
  failed: number;
}

export interface Candidate {
  agentId: string;
  name: string;
  eligible: boolean;
  reasons: string[];
  score: number;
}

export type Selection = { ok: true; agent: RosterAgent; capability: Capability; candidates: Candidate[] } | { ok: false; reason: string; missingCapability?: string; candidates: Candidate[] };

// idle = healthy and on request (no schedule of its own); paused, attention and retired are not.
const HEALTHY = new Set(["active", "idle"]);

/**
 * The autonomy level an action needs. Read-only work is level 1, work inside Atlas and budgeted
 * research is level 2, allowlisted outside changes are level 3, and anything else that needs a
 * person's approval, publishes or changes an outside system is level 4.
 *
 * Level 3 allowlist (Phase 2, 2026-11-23): pushing an isolated atlas-eng/ branch and opening a pull
 * request from it. Neither can merge, deploy or touch main; merging stays Khaneil's.
 */
export const LEVEL3_ALLOWLIST: ReadonlySet<string> = new Set<string>(["engineering.implement_fix", "engineering.deliver_pr"]);

export function actionLevel(cap: Capability): Autonomy {
  if (cap.approval?.length || cap.sideEffect === "publish") return 4;
  if (cap.sideEffect === "external_write") return LEVEL3_ALLOWLIST.has(cap.id) ? 3 : 4;
  if (cap.sideEffect === "none") return 1;
  return 2;
}

/** Laplace-smoothed success rate: 1 run doesn't make an agent perfect or useless. */
export const reliabilityOf = (s: AgentStats) => (s.succeeded + 1) / (s.succeeded + s.failed + 2);

export function selectAgent(capId: string, roster: readonly RosterAgent[], stats: ReadonlyMap<string, AgentStats>, opts: { exclude?: readonly string[] } = {}): Selection {
  const cap = capability(capId);
  if (!cap) return { ok: false, reason: `No capability called "${capId}" exists in Atlas.`, missingCapability: capId, candidates: [] };
  const granted = Object.entries(AGENT_GRANTS)
    .filter(([, caps]) => caps.includes(capId))
    .map(([id]) => id)
    .sort();
  if (!granted.length) return { ok: false, reason: `No registered agent is granted ${cap.name}.`, missingCapability: capId, candidates: [] };
  const candidates: Candidate[] = granted.map((id) => {
    const a = roster.find((x) => x.id === id);
    const s = stats.get(id) ?? { active: 0, succeeded: 0, failed: 0 };
    const reasons: string[] = [];
    if (!a) reasons.push("not in the Agent Registry on main");
    else if (!HEALTHY.has(a.status)) reasons.push(`status is ${a.status}`);
    if (opts.exclude?.includes(id)) reasons.push("excluded for this task");
    if (cap.neverFromAtlas) reasons.push(`${cap.name} never starts from Atlas`);
    const total = s.succeeded + s.failed;
    const rel = reliabilityOf(s);
    if (total >= 3 && rel < 0.34) reasons.push(`failed ${s.failed} of its last ${total} runs`);
    // Higher is better: reliability first, then spare capacity. Ties go to the lower id.
    const spare = Math.max(0, RUN_LIMITS.perAgentConcurrency - s.active) / RUN_LIMITS.perAgentConcurrency;
    const score = Math.round((rel * 70 + spare * 30) * 100) / 100;
    return { agentId: id, name: a?.name ?? id, eligible: reasons.length === 0, reasons, score };
  });
  const best = candidates.filter((c) => c.eligible).sort((x, y) => y.score - x.score || x.agentId.localeCompare(y.agentId))[0];
  if (!best) {
    const why = candidates.map((c) => `${c.name}: ${c.reasons.join(", ")}`).join("; ");
    return { ok: false, reason: `No eligible agent for ${cap.name} (${why}).`, missingCapability: capId, candidates };
  }
  return { ok: true, agent: roster.find((x) => x.id === best.agentId)!, capability: cap, candidates };
}
