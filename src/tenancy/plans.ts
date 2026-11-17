// Plan entitlements: what an organization may use, kept separate from any payment processing.
// These are conceptual tiers for the data model only. No plan is for sale, none has a price, and
// nothing here talks to a billing provider. An organization's plan id lives in its settings; an
// owner can override single limits (recorded in the audit log).

export const PLAN_IDS = ["personal", "professional", "business", "enterprise"] as const;
export type PlanId = (typeof PLAN_IDS)[number];

export const QUOTA_METRICS = [
  "concurrent_executions",
  "daily_tasks",
  "monthly_model_tokens",
  "daily_api_requests",
  "execution_seconds_max",
  "artifact_storage_bytes",
] as const;
export type QuotaMetric = (typeof QUOTA_METRICS)[number];

export interface Entitlement {
  id: PlanId;
  label: string;
  /** Always false until Khaneil decides to sell plans. Shown so nobody mistakes this for a price list. */
  commerciallyAvailable: false;
  maxUsers: number;
  maxWorkspaces: number;
  limits: Record<QuotaMetric, number>;
  integrations: readonly string[];
  advancedWorkflows: boolean;
  retentionDays: number;
}

const CORE_INTEGRATIONS = ["github", "n8n"] as const;
const ALL_INTEGRATIONS = ["github", "n8n", "cloudflare", "anthropic", "openai"] as const;

export const PLANS: Record<PlanId, Entitlement> = {
  personal: {
    id: "personal",
    label: "Personal",
    commerciallyAvailable: false,
    maxUsers: 1,
    maxWorkspaces: 1,
    limits: { concurrent_executions: 1, daily_tasks: 50, monthly_model_tokens: 500_000, daily_api_requests: 2_000, execution_seconds_max: 300, artifact_storage_bytes: 50_000_000 },
    integrations: CORE_INTEGRATIONS,
    advancedWorkflows: false,
    retentionDays: 30,
  },
  professional: {
    id: "professional",
    label: "Professional",
    commerciallyAvailable: false,
    maxUsers: 5,
    maxWorkspaces: 3,
    limits: { concurrent_executions: 3, daily_tasks: 300, monthly_model_tokens: 3_000_000, daily_api_requests: 10_000, execution_seconds_max: 900, artifact_storage_bytes: 500_000_000 },
    integrations: ALL_INTEGRATIONS,
    advancedWorkflows: true,
    retentionDays: 90,
  },
  business: {
    id: "business",
    label: "Business",
    commerciallyAvailable: false,
    maxUsers: 25,
    maxWorkspaces: 10,
    limits: { concurrent_executions: 10, daily_tasks: 2_000, monthly_model_tokens: 20_000_000, daily_api_requests: 50_000, execution_seconds_max: 1_800, artifact_storage_bytes: 5_000_000_000 },
    integrations: ALL_INTEGRATIONS,
    advancedWorkflows: true,
    retentionDays: 365,
  },
  enterprise: {
    id: "enterprise",
    label: "Enterprise",
    commerciallyAvailable: false,
    maxUsers: 500,
    maxWorkspaces: 100,
    limits: { concurrent_executions: 50, daily_tasks: 20_000, monthly_model_tokens: 200_000_000, daily_api_requests: 500_000, execution_seconds_max: 3_600, artifact_storage_bytes: 50_000_000_000 },
    integrations: ALL_INTEGRATIONS,
    advancedWorkflows: true,
    retentionDays: 730,
  },
};

export const isPlanId = (v: unknown): v is PlanId => typeof v === "string" && (PLAN_IDS as readonly string[]).includes(v);
export const isQuotaMetric = (v: unknown): v is QuotaMetric => typeof v === "string" && (QUOTA_METRICS as readonly string[]).includes(v);

/** Share of a limit at which Atlas warns before refusing. */
export const SOFT_LIMIT_SHARE = 0.8;

export interface OrgPlanSettings {
  planId?: string;
  quotaOverrides?: Partial<Record<string, number>>;
}

/** The plan in force for an organization, with any owner overrides applied. Unknown plan ids fall back to Personal. */
export function effectiveEntitlement(settings: OrgPlanSettings): Entitlement {
  const base = PLANS[isPlanId(settings.planId) ? settings.planId : "personal"];
  const limits = { ...base.limits };
  for (const [k, v] of Object.entries(settings.quotaOverrides ?? {})) {
    if (isQuotaMetric(k) && typeof v === "number" && Number.isFinite(v) && v >= 0) limits[k] = Math.floor(v);
  }
  return { ...base, limits };
}

export type QuotaLevel = "ok" | "warning" | "exceeded";
export function quotaLevel(used: number, limit: number): QuotaLevel {
  if (used >= limit) return "exceeded";
  if (used >= limit * SOFT_LIMIT_SHARE) return "warning";
  return "ok";
}

/**
 * The contract a future billing integration fulfils. Nothing implements it yet: entitlements are
 * enforced from `PLANS` and settings alone, so a payment outage can never change what runs.
 */
export interface BillingProvider {
  /** Map a provider subscription to a plan id. Never called by enforcement code. */
  planFor(subscriptionRef: string): Promise<PlanId | null>;
  /** Report metered usage for a closed period. Must be idempotent on (orgId, period). */
  reportUsage(orgId: string, period: string, totals: Record<string, number>): Promise<void>;
}
