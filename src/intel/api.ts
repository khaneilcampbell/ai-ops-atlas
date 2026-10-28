import { isTauri } from "../lib/env";
import type { AgentConfig, AgentStatus, CostEstimate, Depth, EcoContext, EcoReport, RepoContext, Report, Run } from "./types";

// Everything here goes to the Rust side, which holds the Anthropic key and makes every
// GitHub and Claude request. The web view never sees credentials.
async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}

export const intelApi = {
  available: isTauri,
  status: () => call<AgentStatus>("intel_status"),
  /** Every recorded run; the status only carries the latest 150. */
  runs: () => call<Run[]>("intel_runs"),
  report: (repo: string) => call<Report | null>("intel_report", { repo }),
  reports: () => call<Report[]>("intel_reports"),
  analyze: (repo: string, opts: { force?: boolean; depth?: Depth | null; context?: RepoContext } = {}) =>
    call<{ run_id: string; duplicate: boolean }>("intel_analyze", { repo, force: !!opts.force, depth: opts.depth ?? null, context: opts.context ?? null }),
  cancel: (runId: string) => call<boolean>("intel_cancel", { runId }),
  setConfig: (config: AgentConfig) => call<AgentConfig>("intel_config_set", { config }),
  estimate: (depth?: Depth | null) => call<CostEstimate>("intel_estimate", { depth: depth ?? null }),
  review: () => call<EcoReport | null>("review_report"),
  runReview: (context: EcoContext, opts: { force?: boolean; depth?: Depth | null } = {}) =>
    call<{ run_id: string; duplicate: boolean }>("review_run", { context, force: !!opts.force, depth: opts.depth ?? null }),
  reviewEstimate: (depth?: Depth | null) => call<CostEstimate>("review_estimate", { depth: depth ?? null }),
  onChange: async (fn: () => void): Promise<() => void> => {
    const { listen } = await import("@tauri-apps/api/event");
    return listen("intel-changed", fn);
  },
};

export const anthropicKey = {
  has: () => (isTauri() ? call<boolean>("anthropic_key_status") : Promise.resolve(false)),
  set: (key: string) => call<void>("anthropic_key_set", { key }),
  clear: () => call<void>("anthropic_key_clear"),
};
