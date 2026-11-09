// Mirrors src-tauri/src/actions: the approval-required actions (re-run failed jobs, merge a
// pull request), their switches and the audit log.

export type Stage = "refused" | "cancelled" | "attempted" | "started" | "merged" | "changed" | "opened" | "failed" | "unknown";

export interface ActionsConfig {
  rerun_failed_jobs: { enabled: boolean; repos: string[] };
  token_login: string | null;
  /** Missing in builds from before merging existed. */
  merge_pull_requests?: { enabled: boolean; repos: string[]; token_logins: Record<string, string> };
  /** The account the Manage agents token belongs to. Missing in older builds. */
  agents_token_login?: string | null;
}

export interface ActionsStatus {
  config: ActionsConfig;
  /** Whether an Actions token is saved in the Keychain. The token itself never reaches the web view. */
  token: boolean;
  /** Repositories (lowercase owner/name) with a merge token saved. The tokens never reach the web view. */
  merge_tokens?: string[];
  /** Whether a Manage agents token is saved. Saving it turns Manage agents on. Missing in older builds. */
  agents_token?: boolean;
}

export interface AuditRecord {
  id: string;
  at: string;
  action: string;
  actor: string;
  github_login: string | null;
  repo: string;
  /** 0 for merges. */
  run_id: number;
  pull_number?: number | null;
  /** The catalog agent a Manage agents action targets. */
  agent?: string | null;
  title?: string | null;
  base?: string | null;
  workflow: string | null;
  run_number: number | null;
  attempt_before: number | null;
  head_sha: string | null;
  branch: string | null;
  stage: Stage;
  reason: string | null;
  http_status: number | null;
  request_id: string | null;
  message: string | null;
}

export interface Outcome {
  stage: Stage;
  reason: string | null;
  message: string;
  audit_id: string;
}

/** A pull request as GitHub reported it when Atlas last checked it for merging. */
export interface MergePreview {
  repo: string;
  number: number;
  title: string;
  author: string | null;
  head: string;
  base: string;
  head_sha: string;
  commits: number | null;
  changed_files: number | null;
  additions: number | null;
  deletions: number | null;
  checks: string[];
  required: string[];
  approvals: string[];
  url: string | null;
}

export interface MergeCheck {
  ready: boolean;
  reason: string | null;
  message: string;
  preview: MergePreview | null;
}

/** Manage agents: the three things Atlas can do to an allow-listed agent's workflow. */
export type AgentOp = "enable" | "disable" | "run_now";

/** Manage agents: a schedule or cap change, which Atlas always opens as a pull request. */
export type ConfigChange = { field: "schedule"; value: string } | { field: "cap"; value: number };

export interface ConfigOutcome extends Outcome {
  pull_number: number | null;
  url: string | null;
  before: string | null;
  after: string | null;
}
