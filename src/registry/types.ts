// Agent Registry model. Manifest fields (maintained by hand in catalog/*.yaml) live in
// `RegistryManifest`; everything observed at runtime lives in `Telemetry` and is never
// written back to a manifest. `null` always means "nobody has documented this".

export const CLASSIFICATIONS = ["A", "B", "C", "D", "E", "F"] as const;
export type Classification = (typeof CLASSIFICATIONS)[number] | "unclassified";

export const CLASSIFICATION_INFO: Record<Classification, { label: string; short: string; description: string }> = {
  A: { label: "AI Agent", short: "AI agent", description: "Uses an AI model to interpret inputs, reason about tasks or select actions within defined boundaries." },
  B: { label: "AI-Assisted Workflow", short: "AI-assisted", description: "Uses an AI model inside a predefined workflow." },
  C: { label: "Deterministic Automation", short: "Automation", description: "Performs predefined steps without AI-driven decisions." },
  D: { label: "CI/CD Pipeline", short: "CI/CD", description: "Runs tests, builds, validation or deployment workflows." },
  E: { label: "Utility or Integration", short: "Integration", description: "Provides a reusable capability or connects systems without carrying out an agent mission." },
  F: { label: "Planned Agent", short: "Planned", description: "A proposed capability that has not been implemented." },
  unclassified: { label: "Unclassified", short: "Unclassified", description: "No classification declared in the manifest." },
};

export const CONFIDENCES = ["verified", "provisional", "unverified"] as const;
export type Confidence = (typeof CONFIDENCES)[number];

export const CATEGORIES = ["engineering", "security", "business", "data", "career", "infrastructure"] as const;
export type Category = (typeof CATEGORIES)[number] | "uncategorized";

export const CATEGORY_LABEL: Record<Category, string> = {
  engineering: "Engineering & Development",
  security: "Security & Compliance",
  business: "Business Operations",
  data: "Data & Intelligence",
  career: "Career & Productivity",
  infrastructure: "Infrastructure & Operations",
  uncategorized: "Uncategorized",
};

export const TRIGGER_TYPES = ["manual", "scheduled", "event", "continuous"] as const;
export type TriggerType = (typeof TRIGGER_TYPES)[number];
export const TRIGGER_LABEL: Record<TriggerType, string> = { manual: "Manual", scheduled: "Scheduled", event: "Event-driven", continuous: "Continuous" };

export const AUTONOMY_LEVELS = [0, 1, 2, 3, 4] as const;
export type AutonomyLevel = (typeof AUTONOMY_LEVELS)[number];
export const AUTONOMY_INFO: Record<AutonomyLevel, { label: string; description: string }> = {
  0: { label: "Observe", description: "Read-only data collection and monitoring." },
  1: { label: "Recommend", description: "Generates insights and proposed actions without making external changes." },
  2: { label: "Approval required", description: "Prepares actions that need explicit human authorization before they run." },
  3: { label: "Limited autonomous execution", description: "Performs approved, narrowly scoped actions with predefined controls." },
  4: { label: "Advanced orchestration", description: "Coordinates multiple agents under explicit policies, permission boundaries and audit controls." },
};

export const RISK_LEVELS = ["low", "medium", "high"] as const;
export type Risk = (typeof RISK_LEVELS)[number];

export const SENSITIVITIES = ["public", "internal", "confidential", "restricted"] as const;
export type Sensitivity = (typeof SENSITIVITIES)[number];

export const KPI_KINDS = ["reliability", "quality", "cost", "throughput", "other"] as const;
export type KpiKind = (typeof KPI_KINDS)[number];

/** Telemetry sources the app can compute an observed KPI value from. */
export const KPI_MEASURES = ["run_success_rate", "runs_last_30d", "avg_duration_minutes", "month_spend_usd"] as const;
export type KpiMeasure = (typeof KPI_MEASURES)[number];

export interface Kpi {
  name: string;
  kind: KpiKind;
  /** The target as written by a person, for example "≥ 95% of runs succeed". */
  target: string | null;
  /** Numeric target for comparison with an observed value, when the KPI has one. */
  targetValue: number | null;
  /** "min" means observed should be at least the target, "max" at most. */
  direction: "min" | "max" | null;
  /** Where the target comes from (a config value, a decision). */
  basis: string | null;
  /** How Atlas measures it; null when no telemetry is connected. */
  measure: KpiMeasure | null;
}

/** Hand-maintained registry fields from a manifest's `registry` block. */
export interface RegistryManifest {
  title?: string;
  suggestedTitle?: string;
  summary?: string;
  category?: Category;
  subcategory?: string;
  classification?: { type: Classification; confidence: Confidence; evidence?: string };
  version?: string;
  mission?: { purpose?: string; problem?: string; outcomes: string[]; beneficiaries: string[] };
  responsibilities?: { tasks: string[]; tools: string[]; inputs: string[]; outputs: string[]; dependencies: string[]; limitations: string[] };
  goals?: { objective?: string; reviewFrequency?: string; kpis: Kpi[] };
  execution?: { triggerType?: TriggerType; schedule?: string; environment?: string; stages: string[] };
  governance?: {
    autonomy?: AutonomyLevel;
    autonomyNote?: string;
    dataSensitivity?: Sensitivity;
    approval?: string;
    credentialOwner?: string;
    risk?: Risk;
    auditLog?: string;
  };
  cost?: { budget?: string; notes?: string };
  docs?: { technical?: string; runbook?: string; knownIssues: string[]; improvements: string[]; lastReview?: string | null };
}

/** One execution as observed by Atlas or recorded by hand. */
export interface ExecutionRecord {
  at: string;
  result: "success" | "failure" | "running" | "other";
  label: string;
  url?: string;
  durationMs?: number | null;
  costUsd?: number | null;
  source: "github" | "atlas-intel" | "manual";
}

/** Derived at runtime. Never stored in a manifest. */
export interface Telemetry {
  /** Where live execution data comes from, or null when nothing is connected. */
  source: "github" | "atlas-intel" | null;
  /** True when Atlas has looked at the source (the repository or the agent was loaded). */
  loaded: boolean;
  executions: ExecutionRecord[];
  lastVerifiedRun: ExecutionRecord | null;
  lastAnyRun: ExecutionRecord | null;
  successRate: number | null;
  failures: number;
  avgDurationMs: number | null;
  monthSpendUsd: number | null;
  monthBudgetUsd: number | null;
}

/** "verified" = Atlas has seen a successful run; "configured" = only a configuration exists. */
export type Operational = "verified" | "failing" | "configured" | "planned";
