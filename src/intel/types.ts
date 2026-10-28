// Mirrors src-tauri/src/intel/types.rs. Deterministic facts and findings are verified;
// `ai` is Claude's assessment and is always shown as unverified.

export type Depth = "quick" | "standard" | "deep";

export interface Price {
  input: number;
  output: number;
  cache_read?: number | null;
  cache_write?: number | null;
}

export interface AgentConfig {
  depth: Depth;
  models: Record<Depth, string>;
  pricing: Record<string, Price>;
  max_run_usd: number;
  monthly_budget_usd: number;
  timeout_secs: number;
  max_attempts: number;
  refusal_fallback: boolean;
  schedule: Schedule;
  assigned: string[];
  /** The Senior Engineering Reviewer: its own depth, per-run cap and weekly schedule. */
  review: { depth: Depth; max_run_usd: number; schedule: Schedule };
}

/** days: 0 = Monday … 6 = Sunday; at: local "HH:MM". */
export interface Schedule {
  enabled: boolean;
  days: number[];
  at: string;
  consent_at: string | null;
}

export type Assessed<T> = { state: "assessed"; data: T } | { state: "not_assessed"; reason: string };

export interface ItemFact {
  number: number;
  title: string;
  labels: string[];
  created_at: string | null;
  url: string | null;
}

export interface AlertsFact {
  open: number;
  by_severity: Record<string, number>;
  top: { number: number; severity: string; subject: string; summary: string; url: string | null }[];
}

export type CiState = "passing" | "failing" | "running" | "no_runs" | "not_assessed";

export interface Facts {
  full_name: string;
  url: string;
  description: string | null;
  homepage: string | null;
  visibility: string;
  default_branch: string;
  archived: boolean;
  fork: boolean;
  empty: boolean;
  head_sha: string | null;
  created_at: string | null;
  pushed_at: string | null;
  languages: { name: string; percent: number }[];
  stack: string[];
  agent_signals: string[];
  root_files: string[];
  activity: {
    commits_sampled: number;
    commits_last_30d: number;
    last_commit_at: string | null;
    authors: string[];
    recent: { sha: string; message: string; author: string; date: string | null; url: string | null }[];
    branches: number | null;
    open_prs: number | null;
    pr_titles: ItemFact[];
  };
  releases: Assessed<{ tag: string; name: string | null; published_at: string | null; url: string | null }[]>;
  issues: Assessed<{ open: number; recent: ItemFact[] }>;
  ci: {
    state: CiState;
    workflows: { run_id: number; name: string; status: string; conclusion: string | null; branch: string; at: string | null; url: string | null }[];
    note: string | null;
  };
  docs: { readme: boolean; readme_chars: number; license: string | null; contributing: boolean; changelog: boolean; docs_dir: boolean; security_policy: boolean };
  security: { dependabot: Assessed<AlertsFact>; code_scanning: Assessed<AlertsFact> };
  collected_at: string;
  github_requests: number;
}

export type Severity = "info" | "low" | "medium" | "high" | "critical";

export interface Finding {
  id: string;
  category: string;
  severity: Severity;
  title: string;
  detail: string;
  url: string | null;
}

export interface Observation {
  text: string;
  evidence: string[];
  grounded: boolean;
}

export type Rating = "good" | "fair" | "poor" | "unknown";

export interface AiAnalysis {
  summary: string;
  purpose: string;
  architecture: string;
  maturity: "prototype" | "early_development" | "active_development" | "maintained" | "stale" | "unknown";
  implementation_status: string;
  technologies: string[];
  agent_integrations: string[];
  health: { area: string; rating: Rating; rationale: string; evidence: string[]; grounded: boolean }[];
  maintenance_issues: Observation[];
  documentation_gaps: Observation[];
  technical_debt: Observation[];
  security_observations: Observation[];
  recommendations: { priority: "high" | "medium" | "low"; title: string; rationale: string; evidence: string[]; grounded: boolean }[];
  insufficient_data: boolean;
  data_gaps: string[];
}

export type AiState = "analyzed" | "reused" | "insufficient_data" | "stale" | "not_assessed";

export interface Report {
  repo: string;
  facts: Facts;
  findings: Finding[];
  ai: AiAnalysis | null;
  ai_state: AiState;
  analyzed_at: string | null;
  analysis_run_id: string | null;
  model: string | null;
  depth: Depth;
  fingerprint: string;
  validation: { dropped_refs: number; ungrounded_items: number; trimmed_fields: number } | null;
  updated_at: string;
  run_id: string;
  context: { project: string | null; agents: string[] };
  note: string | null;
}

export type RunStatus = "queued" | "running" | "succeeded" | "reused" | "insufficient_data" | "blocked" | "failed" | "cancelled" | "interrupted";

export interface Usage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
  served_by: string | null;
  fallback: boolean;
}

export interface CostEstimate {
  model: string;
  input_tokens_est: number;
  max_output_tokens: number;
  worst_case_usd: number;
  month_spent_usd: number;
  max_run_usd: number;
  monthly_budget_usd: number;
}

export interface TraceStep {
  at: string;
  step: string;
  ok: boolean;
  detail: string;
  ms: number | null;
}

export interface Run {
  id: string;
  /** Missing on runs recorded before the engineering review existed. */
  kind?: "repository" | "ecosystem";
  /** owner/name, or "ecosystem" for an engineering review. */
  repo: string;
  trigger: "manual" | "scheduled";
  depth: Depth;
  model: string;
  force: boolean;
  status: RunStatus;
  queued_at: string;
  started_at: string | null;
  finished_at: string | null;
  duration_ms: number | null;
  error: { kind: string; message: string; retryable: boolean } | null;
  attempts: number;
  github_requests: number;
  usage: Usage | null;
  estimate: CostEstimate | null;
  cost_usd: number | null;
  trace: TraceStep[];
}

export interface AgentStatus {
  id: string;
  name: string;
  version: string;
  prompt_version: string;
  config: AgentConfig;
  key_present: boolean;
  active: string[];
  runs: Run[];
  month_spent_usd: number;
}

export interface RepoContext {
  project?: string | null;
  agents?: string[];
}

// ---------- Senior Engineering Reviewer (mirrors src-tauri/src/intel/review.rs) ----------

export interface EcoContext {
  projects: { id: string; name: string; repository: string; status: string }[];
  agents: {
    id: string;
    name: string;
    project: string;
    repository: string;
    kind: string | null;
    autonomy: number | null;
    autonomy_note: string | null;
    trigger: string | null;
    permissions: string[];
    telemetry: boolean;
    status: string;
    approval: string | null;
    risk: string | null;
  }[];
}

export interface WorkflowScan {
  file: string;
  top_level_permissions: boolean;
  job_permissions: boolean;
  write_scopes: string[];
  pull_request_target: boolean;
  unpinned_actions: string[];
  timeouts: boolean;
  concurrency: boolean;
  schedules: number;
  uses_secrets: boolean;
  url: string | null;
}

export interface RepoChecks {
  dependabot_config: Assessed<boolean>;
  renovate_config: boolean;
  codeowners: Assessed<boolean>;
  branch_rules: Assessed<{ protected: boolean; requires_pull_request: boolean; required_checks: string[]; required_approvals: number | null; blocks_force_push: boolean; source: string }>;
  workflows: Assessed<WorkflowScan[]>;
  workflow_files: number;
  github_requests: number;
}

export interface RepoEntry {
  repo: string;
  source: "intel_report" | "collected" | "unavailable";
  facts: Facts | null;
  checks: RepoChecks | null;
  findings: Finding[];
  error: string | null;
}

export type ReviewArea = "security" | "reliability" | "testing" | "dependencies" | "autonomy" | "observability" | "cost" | "documentation" | "tooling";

export interface EcoReview {
  summary: string;
  scorecard: { area: ReviewArea; rating: Rating; rationale: string; evidence: string[]; grounded: boolean }[];
  top_risks: { title: string; severity: "critical" | "high" | "medium" | "low"; why: string; repos: string[]; evidence: string[]; grounded: boolean }[];
  recommendations: {
    priority: "now" | "next" | "later";
    category: ReviewArea;
    title: string;
    rationale: string;
    first_step: string;
    effort: "hours" | "a_day" | "a_week";
    repos: string[];
    evidence: string[];
    grounded: boolean;
  }[];
  tools: { name: string; purpose: string; why: string; cost: "free" | "paid"; repos: string[] }[];
  autonomy_notes: { agent: string; current_level: number; suggested_level: number; reason: string; evidence: string[]; grounded: boolean }[];
  quick_wins: string[];
  data_gaps: string[];
}

export interface EcoReport {
  repos: RepoEntry[];
  context: EcoContext;
  review: EcoReview | null;
  state: AiState;
  analyzed_at: string | null;
  analysis_run_id: string | null;
  model: string | null;
  depth: Depth;
  fingerprint: string;
  validation: { dropped_refs: number; ungrounded_items: number; trimmed_fields: number; unknown_names: number } | null;
  updated_at: string;
  run_id: string;
  github_requests: number;
  reused_facts: number;
  note: string | null;
}
