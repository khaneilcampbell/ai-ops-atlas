import { isTauri } from "../lib/env";
import type { ActionsStatus, AuditRecord, Outcome } from "./types";

// The only route to a GitHub write. The Rust side checks the switch, reads the run again,
// asks for approval in a native dialog and writes the audit log; the web view only asks.
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
  onChange: async (fn: () => void): Promise<() => void> => {
    const { listen } = await import("@tauri-apps/api/event");
    return listen("actions-changed", fn);
  },
};
