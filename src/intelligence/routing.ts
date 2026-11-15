import type { Sensitivity } from "../registry/types";
import type { ModelTier } from "../execution/policy";
import type { ModelTierNumber } from "./types";

// Model routing: which tier and model a piece of work should get, from fixed rules.
//   Tier 0, no AI: validation, routing, status checks, database queries, decisions, approvals
//   Tier 1, lightweight: classification, extraction, simple summaries
//   Tier 2, advanced: complex research, architecture, planning, root-cause analysis
// Complexity can move a step one tier, privacy can force tier 0, and a step that would exceed its
// remaining budget drops a tier when that's allowed or is held for Khaneil. Prices below are
// published list prices used only for estimates; billed cost always comes from the provider.

export interface ModelPrice {
  model: string;
  provider: string;
  inputPerM: number;
  outputPerM: number;
}

/** Anthropic list prices (USD per million tokens), checked 2026-11-15. Estimates only. */
export const MODEL_PRICES: Record<"light" | "advanced" | "code", ModelPrice> = {
  light: { model: "claude-haiku-5-5", provider: "anthropic", inputPerM: 0.1, outputPerM: 0.5 },
  advanced: { model: "claude-sonnet-5-5", provider: "anthropic", inputPerM: 2, outputPerM: 10 },
  code: { model: "claude-opus-5-5", provider: "anthropic", inputPerM: 4, outputPerM: 20 },
};

export const TASK_TYPES = ["validation", "routing", "status_check", "db_query", "decision", "approval", "classification", "extraction", "summary", "research", "architecture", "planning", "root_cause", "scoring", "code"] as const;
export type TaskType = (typeof TASK_TYPES)[number];

const BASE: Record<TaskType, ModelTierNumber> = {
  validation: 0,
  routing: 0,
  status_check: 0,
  db_query: 0,
  decision: 0,
  approval: 0,
  classification: 1,
  extraction: 1,
  summary: 1,
  research: 2,
  architecture: 2,
  planning: 2,
  root_cause: 2,
  scoring: 2,
  code: 2,
};
/** Work that never goes below tier 2, whatever the budget. */
const FLOOR_TWO = new Set<TaskType>(["architecture", "root_cause", "code"]);

export const TIER_LABEL: Record<ModelTierNumber, string> = { 0: "Tier 0 · No AI", 1: "Tier 1 · Lightweight AI", 2: "Tier 2 · Advanced AI" };
export const TIER_LIMITS: Record<ModelTierNumber, { maxInputTokens: number; maxOutputTokens: number; retries: number }> = {
  0: { maxInputTokens: 0, maxOutputTokens: 0, retries: 0 },
  1: { maxInputTokens: 8_000, maxOutputTokens: 1_000, retries: 2 },
  2: { maxInputTokens: 32_000, maxOutputTokens: 4_000, retries: 2 },
};

export interface RouteRequest {
  taskType: TaskType;
  complexity?: "low" | "medium" | "high";
  sensitivity?: Sensitivity;
  /** USD left in the step's cap. */
  budgetRemainingUsd?: number;
  estInputTokens?: number;
  estOutputTokens?: number;
  /** The tier the agent can actually reach (its granted model capabilities). */
  availableTiers?: ModelTierNumber[];
}

export interface ModelRoute {
  tier: ModelTierNumber;
  model: string | null;
  provider: string | null;
  maxInputTokens: number;
  maxOutputTokens: number;
  retries: number;
  /** Prompt caching allowed: stable prompt and no confidential data. */
  cache: boolean;
  estimatedUsd: number;
  reasons: string[];
  /** Set when the work can't run as asked and needs a person. */
  held?: string;
}

export const priceFor = (tier: ModelTierNumber, taskType: TaskType): ModelPrice | null => (tier === 0 ? null : tier === 1 ? MODEL_PRICES.light : taskType === "code" ? MODEL_PRICES.code : MODEL_PRICES.advanced);

export const estimateUsd = (p: ModelPrice | null, input: number, output: number) => (p ? (input * p.inputPerM + output * p.outputPerM) / 1_000_000 : 0);

export function routeModel(req: RouteRequest): ModelRoute {
  const reasons: string[] = [];
  let tier = BASE[req.taskType];
  reasons.push(`${req.taskType.replace("_", " ")} starts at tier ${tier}`);
  if (tier === 1 && req.complexity === "high") {
    tier = 2;
    reasons.push("high complexity moves it to tier 2");
  } else if (tier === 2 && req.complexity !== "high" && req.complexity !== undefined && !FLOOR_TWO.has(req.taskType) && req.taskType !== "scoring" && req.taskType !== "planning") {
    tier = 1;
    reasons.push(`${req.complexity} complexity keeps it at tier 1`);
  }
  const sensitivity = req.sensitivity ?? "internal";
  const finish = (t: ModelTierNumber, held?: string): ModelRoute => {
    const p = priceFor(t, req.taskType);
    const lim = TIER_LIMITS[t];
    const input = Math.min(req.estInputTokens ?? lim.maxInputTokens / 2, lim.maxInputTokens);
    const output = Math.min(req.estOutputTokens ?? lim.maxOutputTokens / 2, lim.maxOutputTokens);
    return { tier: t, model: p?.model ?? null, provider: p?.provider ?? null, ...lim, cache: t > 0 && (sensitivity === "public" || sensitivity === "internal"), estimatedUsd: Math.round(estimateUsd(p, input, output) * 10_000) / 10_000, reasons, ...(held ? { held } : {}) };
  };
  if (tier > 0 && sensitivity === "restricted") {
    reasons.push("restricted data never goes to a model");
    return finish(0, "Restricted data: a person handles this step.");
  }
  if (req.availableTiers && tier > 0 && !req.availableTiers.includes(tier)) {
    const lower = tier === 2 && req.availableTiers.includes(1) && !FLOOR_TWO.has(req.taskType) ? 1 : null;
    if (lower === null) return finish(0, `The agent isn't authorised for a tier ${tier} model.`);
    reasons.push("the agent only has a tier 1 model");
    tier = lower;
  }
  if (tier > 0 && req.budgetRemainingUsd !== undefined) {
    const lim = TIER_LIMITS[tier];
    const est = estimateUsd(priceFor(tier, req.taskType), Math.min(req.estInputTokens ?? lim.maxInputTokens / 2, lim.maxInputTokens), Math.min(req.estOutputTokens ?? lim.maxOutputTokens / 2, lim.maxOutputTokens));
    if (est > req.budgetRemainingUsd) {
      if (tier === 2 && !FLOOR_TWO.has(req.taskType) && req.complexity !== "high") {
        reasons.push(`$${est.toFixed(4)} estimated is over the $${req.budgetRemainingUsd.toFixed(4)} left, so tier 1`);
        tier = 1;
        const est1 = estimateUsd(MODEL_PRICES.light, Math.min(req.estInputTokens ?? 4_000, 8_000), Math.min(req.estOutputTokens ?? 500, 1_000));
        if (est1 > req.budgetRemainingUsd) return finish(0, "Over the step's model budget. Khaneil can raise the cap.");
      } else return finish(0, "Over the step's model budget. Khaneil can raise the cap.");
    }
  }
  return finish(tier);
}

export const tierFromPolicy = (t: ModelTier): ModelTierNumber => (t === "none" ? 0 : t === "small" ? 1 : 2);

/** Tier of a model name as reported in usage, for checking the route was followed. */
export function tierOfModel(model: string): ModelTierNumber | null {
  const m = model.toLowerCase();
  if (/haiku|mini|nano|flash/.test(m)) return 1;
  if (/sonnet|opus|fable|gpt-5|o3|o1/.test(m)) return 2;
  return null;
}
