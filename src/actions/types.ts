// Mirrors src-tauri/src/actions: the approval-required re-run action, its switch and audit log.

export type Stage = "refused" | "cancelled" | "attempted" | "started" | "failed" | "unknown";

export interface ActionsConfig {
  rerun_failed_jobs: { enabled: boolean; repos: string[] };
  token_login: string | null;
}

export interface ActionsStatus {
  config: ActionsConfig;
  /** Whether an Actions token is saved in the Keychain. The token itself never reaches the web view. */
  token: boolean;
}

export interface AuditRecord {
  id: string;
  at: string;
  action: string;
  actor: string;
  github_login: string | null;
  repo: string;
  run_id: number;
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
