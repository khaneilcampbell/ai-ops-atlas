import raw from "./agents.json";
import { minIntervalMinutes, parseCron } from "./cron";

// The allow-list of agents the Manage view covers, and the limits any change to them must
// stay inside. The Mac app's write module reads the same file, so the two can't drift.

export interface ManagedCap {
  /** Policy file in the repository that holds the cap. */
  file: string;
  /** Dotted path of the one key that holds the monthly cap in US dollars. */
  key: string;
  usd: number;
  /** Hard maximum. No change can set the cap above this. */
  maxUsd: number;
}

export interface ManagedAgent {
  /** Catalog agent id. */
  id: string;
  /** Workflow file name under .github/workflows. */
  workflow: string;
  /** The workflow's one `schedule` cron line, as it is on main. */
  schedule: string;
  /** Other triggers, in words, for the schedule column. */
  alsoRuns?: string;
  /** Calls a paid API, so it gets the longer minimum interval. */
  paid: boolean;
  cap?: ManagedCap;
}

export interface Manifest {
  version: 1;
  repository: string;
  agents: ManagedAgent[];
}

/** Runs closer together than this are refused for any agent. */
export const MIN_INTERVAL_MINUTES = 15;
/** Agents that call a paid API run at most this often. */
export const PAID_MIN_INTERVAL_MINUTES = 240;
/** No agent's own cap can go above this, whatever its entry says. */
export const HARD_MAX_CAP_USD = 5;

const ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const WORKFLOW = /^[a-z0-9][a-z0-9-]{0,63}\.ya?ml$/;
const POLICY_FILE = /^ops\/[a-z0-9-]+\/[a-z0-9-]+\.json$/;
const KEY = /^[A-Za-z][A-Za-z0-9]*(?:\.[A-Za-z][A-Za-z0-9]*){0,3}$/;

/** Checks a new schedule against an agent's limits. Returns the problem in words, or null when it's fine. */
export function scheduleProblem(a: Pick<ManagedAgent, "paid">, text: string): string | null {
  let gap: number | null;
  try {
    gap = minIntervalMinutes(parseCron(text));
  } catch (e) {
    return (e as Error).message;
  }
  if (gap === null) return "That schedule never runs.";
  const min = a.paid ? PAID_MIN_INTERVAL_MINUTES : MIN_INTERVAL_MINUTES;
  if (gap < min) return `Runs must be at least ${min >= 60 ? `${min / 60} hours` : `${min} minutes`} apart${a.paid ? " for an agent that calls a paid API" : ""}.`;
  return null;
}

/** Checks a new monthly cap. Whole cents only, from $0 up to the agent's maximum. */
export function capProblem(cap: Pick<ManagedCap, "maxUsd">, usd: number): string | null {
  if (typeof usd !== "number" || !Number.isFinite(usd)) return "The cap must be a number of dollars.";
  if (usd < 0) return "The cap can't be negative.";
  if (Math.round(usd * 100) !== usd * 100) return "Use whole cents, for example 1.50.";
  const max = Math.min(cap.maxUsd, HARD_MAX_CAP_USD);
  if (usd > max) return `The cap can be at most $${max.toFixed(2)} a month.`;
  return null;
}

/** Every problem with the manifest itself. An empty list means it is safe to use. */
export function manifestProblems(m: Manifest): string[] {
  const out: string[] = [];
  if (m.version !== 1) out.push("Unknown manifest version.");
  if (!/^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/.test(m.repository)) out.push("Bad repository.");
  const seen = new Set<string>();
  for (const a of m.agents) {
    const at = `Agent ${a.id}`;
    if (!ID.test(a.id)) out.push(`${at}: bad id.`);
    if (seen.has(a.id)) out.push(`${at}: listed twice.`);
    seen.add(a.id);
    if (!WORKFLOW.test(a.workflow)) out.push(`${at}: bad workflow file name.`);
    const s = scheduleProblem(a, a.schedule);
    if (s) out.push(`${at}: ${s}`);
    if (a.cap) {
      if (!POLICY_FILE.test(a.cap.file)) out.push(`${at}: cap file must be a JSON file under ops/.`);
      if (!KEY.test(a.cap.key)) out.push(`${at}: bad cap key.`);
      if (!(a.cap.maxUsd > 0 && a.cap.maxUsd <= HARD_MAX_CAP_USD)) out.push(`${at}: cap maximum must be above $0 and at most $${HARD_MAX_CAP_USD}.`);
      const c = capProblem(a.cap, a.cap.usd);
      if (c) out.push(`${at}: ${c}`);
    }
  }
  return out;
}

export const MANIFEST = raw as Manifest;

export const managedAgent = (id: string): ManagedAgent | undefined => MANIFEST.agents.find((a) => a.id === id);
