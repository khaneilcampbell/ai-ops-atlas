import { isHostedWeb, isTauri } from "../lib/env";
import { isBridgeStep, toExecutionReport, type StepReportBody } from "./n8nBridge";
import type { Orchestrator } from "./orchestrator";
import type { DispatchResult, ExecutionAdapter, HandoffEnvelope } from "./types";

// The app side of the n8n bridge. The page asks the site behind Access; the Mac app asks through its
// Rust shell with the website sync key. Neither ever holds an n8n token. Reports are picked up from
// the site and applied through the orchestrator, which only accepts them for the live attempt.

export interface BridgeClient {
  status(): Promise<boolean>;
  send(env: HandoffEnvelope): Promise<DispatchResult>;
  reports(since: number): Promise<{ reports: StepReportBody[]; cursor: number }>;
}

async function web<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(path, { credentials: "same-origin", cache: "no-store", ...init });
  const body = (await r.json().catch(() => null)) as T | null;
  if (body && typeof body === "object" && "state" in body) return body;
  if (!r.ok || !body) throw new Error((body as { message?: string } | null)?.message ?? `The site answered ${r.status}.`);
  return body;
}

export const siteBridge: BridgeClient = {
  async status() {
    if (isHostedWeb()) return (await web<{ configured: boolean }>("/api/n8n/steps?status=1")).configured;
    if (isTauri()) {
      const { invoke } = await import("@tauri-apps/api/core");
      return !!(await invoke<{ configured: boolean } | null>("live_n8n_steps", { since: 0, status: true }))?.configured;
    }
    return false;
  },
  async send(env) {
    if (isHostedWeb()) return web<DispatchResult>("/api/n8n/steps", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(env) });
    if (isTauri()) {
      const { invoke } = await import("@tauri-apps/api/core");
      return (await invoke<DispatchResult | null>("live_n8n_step_send", { envelope: env })) ?? { state: "refused", error: "Website sync isn't set up in the Mac app." };
    }
    return { state: "refused", error: "Steps are sent by the hosted site or the Mac app." };
  },
  async reports(since) {
    if (isHostedWeb()) return web(`/api/n8n/steps?since=${since}`);
    if (isTauri()) {
      const { invoke } = await import("@tauri-apps/api/core");
      return (await invoke<{ reports: StepReportBody[]; cursor: number } | null>("live_n8n_steps", { since, status: false })) ?? { reports: [], cursor: since };
    }
    return { reports: [], cursor: since };
  },
};

export const BRIDGE_NEED = "Set up the n8n bridge: the restricted step runner workflow published in n8n, and N8N_BRIDGE_TOKEN and N8N_BRIDGE_CALLBACK_TOKEN saved as Cloudflare Pages secrets (see docs/workflow-execution.md).";

/**
 * Research and planning steps through the restricted step runner. It spends model money, so it
 * counts as having side effects; the site dedupes by idempotency key, so a bounded retry can't act twice.
 */
export function bridgeAdapter(client: BridgeClient, configured: () => boolean): ExecutionAdapter {
  return {
    kind: "n8n",
    sideEffects: true,
    idempotent: true,
    personStarts: false,
    available: (nodeId) => (!isBridgeStep(nodeId) ? { ok: false, need: "Only research and planning steps can be started from Atlas." } : configured() ? { ok: true } : { ok: false, need: BRIDGE_NEED }),
    dispatch: (env) => client.send(env),
  };
}

const CURSOR_KEY = "atlas:n8n-steps-cursor";
const readCursor = () => {
  try {
    return Number(localStorage.getItem(CURSOR_KEY) ?? 0) || 0;
  } catch {
    return 0;
  }
};
const writeCursor = (n: number) => {
  try {
    localStorage.setItem(CURSOR_KEY, String(n));
  } catch {
    /* the ledger still dedupes by report id */
  }
};

/** Picks up new step reports and applies each through the orchestrator. Returns how many were applied. */
export async function pullReports(orch: Orchestrator, client: BridgeClient = siteBridge, cursor = { read: readCursor, write: writeCursor }): Promise<number> {
  let since = cursor.read();
  let applied = 0;
  for (let page = 0; page < 5; page++) {
    const { reports, cursor: next } = await client.reports(since);
    for (const r of reports) if (orch.receive(toExecutionReport(r)).ok) applied++;
    if (next === since || !reports.length) break;
    since = next;
    cursor.write(since);
  }
  return applied;
}
