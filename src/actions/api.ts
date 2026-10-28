import { isTauri } from "../lib/env";
import type { ActionsStatus, AuditRecord, CatalogEdit, Group, MergeCheck, Op, Outcome, WorkflowInfo } from "./types";

// The only route to a GitHub write. The Rust side checks the switch, reads the run or pull
// request again, asks for approval in a native dialog (and Touch ID for merges) and writes the
// audit log; the web view only asks.
async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}

export const actionsApi = {
  available: isTauri,
  status: () => call<ActionsStatus>("actions_status"),
  audit: (limit?: number) => call<AuditRecord[]>("actions_audit", { limit: limit ?? null }),
  setSettings: (enabled: boolean, repos: string[]) => call<ActionsStatus>("actions_settings_set", { enabled, repos }),
  setToken: (token: string) => call<ActionsStatus>("actions_token_set", { token }),
  clearToken: () => call<ActionsStatus>("actions_token_clear"),
  rerunFailed: (repo: string, runId: number, seenAttempt: number | null) => call<Outcome>("action_rerun_failed", { repo, runId, seenAttempt }),
  setMergeSettings: (enabled: boolean, repos: string[]) => call<ActionsStatus>("actions_merge_settings_set", { enabled, repos }),
  setMergeToken: (repo: string, token: string) => call<ActionsStatus>("merge_token_set", { repo, token }),
  clearMergeToken: (repo: string) => call<ActionsStatus>("merge_token_clear", { repo }),
  /** Read-only readiness check; nothing is sent or logged. */
  mergeCheck: (repo: string, number: number) => call<MergeCheck>("action_merge_check", { repo, number }),
  mergePr: (repo: string, number: number, seenSha: string) => call<Outcome>("action_merge_pr", { repo, number, seenSha }),
  setOpSettings: (group: Group, enabled: boolean, repos: string[]) => call<ActionsStatus>("actions_op_settings_set", { group, enabled, repos }),
  op: (repo: string, op: Op) => call<Outcome>("action_op", { repo, op }),
  /** Read-only; nothing is sent or logged. */
  workflowInfo: (repo: string, workflow: string) => call<WorkflowInfo>("action_workflow_info", { repo, workflow }),
  catalogOverrides: () => call<Record<string, CatalogEdit>>("catalog_overrides"),
  /** Asks in a native dialog; `false` when nothing changed or it was cancelled. */
  setCatalogOverride: (agent: string, edit: CatalogEdit) => call<boolean>("catalog_override_set", { agent, edit }),
  onChange: async (fn: () => void): Promise<() => void> => {
    const { listen } = await import("@tauri-apps/api/event");
    return listen("actions-changed", fn);
  },
};
