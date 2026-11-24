import { PHASE_ORDER, SIDE_PHASES, TERMINAL_PHASES, type Activity, type EngineeringPhase, type FailureCategory } from "./types";

// The engineering lifecycle rules and the model routing policy. Pure functions: the server engine
// asks here before every phase write, and the panel and the office use the same activity mapping.

/** A phase may move forward along the main line (skipping is allowed, going back is not) or to a side state. */
export function canMovePhase(from: EngineeringPhase, to: EngineeringPhase): boolean {
  if (from === to) return false;
  if (TERMINAL_PHASES.has(from)) return false;
  if (SIDE_PHASES.has(to)) return true;
  // BLOCKED and AWAITING_APPROVAL return to the main line where work picks up again.
  if (from === "BLOCKED" || from === "AWAITING_APPROVAL") return true;
  const a = PHASE_ORDER.indexOf(from);
  const b = PHASE_ORDER.indexOf(to);
  return a >= 0 && b > a;
}

/** The runner's reported phases, in order, with only known main-line names and real times. */
export function cleanRunnerPhases(raw: unknown): { phase: EngineeringPhase; at: string }[] {
  if (!Array.isArray(raw)) return [];
  const allowed = new Set<EngineeringPhase>(["CONTEXT_COLLECTED", "IMPLEMENTATION_PLANNED", "POLICY_CHECKED", "WORKSPACE_PREPARED", "CODE_MODIFIED", "VALIDATION_STARTED", "VALIDATION_COMPLETED"]);
  const out: { phase: EngineeringPhase; at: string }[] = [];
  let last = PHASE_ORDER.indexOf("TASK_ASSIGNED");
  for (const p of raw.slice(0, 12)) {
    if (!p || typeof p !== "object") continue;
    const phase = (p as { phase?: unknown }).phase as EngineeringPhase;
    const at = (p as { at?: unknown }).at;
    if (!allowed.has(phase) || typeof at !== "string" || Number.isNaN(Date.parse(at))) continue;
    const i = PHASE_ORDER.indexOf(phase);
    if (i <= last) continue;
    last = i;
    out.push({ phase, at: new Date(at).toISOString() });
  }
  return out;
}

/** What the agent's desk shows for a phase. Derived only from recorded phases. */
export function engineerActivity(phase: EngineeringPhase | null): Activity {
  switch (phase) {
    case null:
    case "PR_READY":
    case "FAILED":
    case "CANCELLED":
      return "IDLE";
    case "TASK_ASSIGNED":
    case "CONTEXT_COLLECTED":
    case "IMPLEMENTATION_PLANNED":
    case "POLICY_CHECKED":
      return "INVESTIGATING";
    case "WORKSPACE_PREPARED":
    case "CODE_MODIFIED":
      return "CODING";
    case "VALIDATION_STARTED":
    case "VALIDATION_COMPLETED":
      return "TESTING";
    case "QA_REVIEW_REQUESTED":
      return "REVIEWING";
    case "BLOCKED":
    case "AWAITING_APPROVAL":
      return "BLOCKED";
  }
}

export const ACTIVITY_LABEL: Record<Activity, string> = {
  IDLE: "Idle",
  INVESTIGATING: "Investigating",
  CODING: "Coding",
  TESTING: "Testing",
  REVIEWING: "Reviewing",
  BLOCKED: "Blocked",
};

/**
 * Model routing. Claude Code takes the aliases "opus", "sonnet" and "haiku" and resolves them to the
 * newest model of that tier the account can use, so no version is hard-coded here. Routine fixes
 * use the cost-efficient tier; a repair after QA sent the change back, or a failing test (usually
 * harder to reason about), uses the highest tier. Summaries and classification use no model at all:
 * they're plain code. ATLAS_ENGINEERING_MODELS="routine=sonnet,complex=opus" overrides the tiers.
 */
export type ModelTier = "routine" | "complex";
export const DEFAULT_MODELS: Record<ModelTier, string> = { routine: "sonnet", complex: "opus" };
const ALIASES = new Set(["opus", "sonnet", "haiku"]);

export function modelTiers(setting: string | undefined): Record<ModelTier, string> {
  const out = { ...DEFAULT_MODELS };
  for (const part of (setting ?? "").split(",")) {
    const [k, v] = part.split("=").map((x) => x.trim().toLowerCase());
    if ((k === "routine" || k === "complex") && v && (ALIASES.has(v) || /^claude-[a-z0-9-]{3,60}$/.test(v))) out[k] = v;
  }
  return out;
}

export function routeModel(category: FailureCategory, repairIteration: number, models: Record<ModelTier, string> = DEFAULT_MODELS): { tier: ModelTier; model: string } {
  const tier: ModelTier = repairIteration > 0 || category === "test" ? "complex" : "routine";
  return { tier, model: models[tier] };
}
