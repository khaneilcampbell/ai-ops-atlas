// Production health, shared by the site (server/health.ts) and the app's Production health panel.
// Unknown is its own state and never counts as healthy.

import { isHostedWeb, isTauri } from "../lib/env";

export type HealthState = "healthy" | "degraded" | "unavailable" | "unknown";

export interface HealthCheck {
  id: string;
  label: string;
  state: HealthState;
  detail: string;
  /** A critical check that is unavailable makes the whole site unavailable. */
  critical?: boolean;
  checkedAt: string;
}

export interface CredentialStatus {
  id: string;
  label: string;
  configured: boolean;
  scope: string;
}

export interface HealthReport {
  overall: HealthState;
  checkedAt: string;
  checks: HealthCheck[];
  credentials: CredentialStatus[];
  metrics: {
    workflowSuccessRate: number | null;
    workflowFailures24h: number | null;
    runningExecutions: number | null;
    lastAgentRunAt: string | null;
  };
}

/** Alert and status thresholds, in one place so the panel and the docs agree. */
export const HEALTH_THRESHOLDS = {
  databaseTimeoutMs: 3_000,
  databaseSlowMs: 1_000,
  probeTimeoutMs: 5_000,
  /** Below 10% of the hourly GitHub allowance left. */
  githubRemainingDegraded: 0.1,
  /** Three or more failed n8n runs on published workflows in 24 hours. */
  n8nFailuresDegraded: 3,
  /** Fewer than 80% of recent finished runs succeeded. */
  successRateDegraded: 0.8,
  /** Production agents heartbeat every 5 minutes; 15 minutes of silence is stale. */
  productionStaleMs: 15 * 60_000,
  /** A step send still "sending" after 2 minutes never got an answer. */
  dispatchStuckMs: 2 * 60_000,
} as const;

/**
 * The site's overall state: unavailable when a critical check is down, degraded when anything is
 * degraded or down, healthy only when every critical check is healthy. Unknown checks never make
 * the site look healthier than what was actually verified: with nothing verified it is unknown.
 */
export function overallState(checks: readonly HealthCheck[]): HealthState {
  if (checks.some((c) => c.critical && c.state === "unavailable")) return "unavailable";
  if (checks.some((c) => c.state === "unavailable" || c.state === "degraded")) return "degraded";
  const critical = checks.filter((c) => c.critical);
  if (critical.length && critical.every((c) => c.state === "healthy")) return "healthy";
  return "unknown";
}

export const STATE_LABEL: Record<HealthState, string> = { healthy: "Healthy", degraded: "Degraded", unavailable: "Unavailable", unknown: "Unknown" };

export type HealthLoad = { kind: "idle" } | { kind: "loading" } | { kind: "ok"; report: HealthReport } | { kind: "not-configured"; message: string } | { kind: "error"; message: string };

/** Reads the site's health report: /api/health on the web, the sync-key hook from the Mac app. */
export async function fetchHealth(): Promise<HealthLoad> {
  try {
    if (isHostedWeb()) {
      const r = await fetch("/api/health", { credentials: "same-origin", cache: "no-store" });
      if (!r.ok) return { kind: "error", message: ((await r.json().catch(() => null)) as { message?: string } | null)?.message ?? `The site answered ${r.status}.` };
      return { kind: "ok", report: (await r.json()) as HealthReport };
    }
    if (isTauri()) {
      const { invoke } = await import("@tauri-apps/api/core");
      const report = await invoke<HealthReport | null>("live_health");
      return report ? { kind: "ok", report } : { kind: "not-configured", message: "Website sync isn't set up in Settings, so the site's health can't be read from the Mac app." };
    }
    return { kind: "not-configured", message: "Health checks run on the hosted site and in the Mac app." };
  } catch (e) {
    return { kind: "error", message: e instanceof Error ? e.message : String(e) };
  }
}
