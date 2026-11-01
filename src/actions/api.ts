import { isTauri } from "../lib/env";
import type { ActionsStatus, AgentOp, AuditRecord, ConfigChange, ConfigOutcome, MergeCheck, Outcome } from "./types";

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
  setAgentsToken: (token: string) => call<ActionsStatus>("agents_token_set", { token }),
  clearAgentsToken: () => call<ActionsStatus>("agents_token_clear"),
  /** Enable, disable or run an allow-listed agent. The Rust side picks the repository and workflow from the agent id. */
  agentAction: (agent: string, op: AgentOp, seenState: string | null) => call<Outcome>("agent_action", { agent, op, seenState }),
  /** Opens a pull request that changes an allow-listed agent's schedule or cap. The Rust side picks the files and re-checks the value. */
  agentConfigChange: (agent: string, change: ConfigChange) => call<ConfigOutcome>("agent_config_change", { agent, change }),
  onChange: async (fn: () => void): Promise<() => void> => {
    const { listen } = await import("@tauri-apps/api/event");
    return listen("actions-changed", fn);
  },
};
