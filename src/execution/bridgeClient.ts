import { isHostedWeb, isTauri } from "../lib/env";
import { BRIDGE_TIMEOUT_MS } from "./policy";
import { isBridgeStep, toExecutionReport, type StepReportBody } from "./n8nBridge";
import type { Orchestrator } from "./orchestrator";
import type { DispatchResult, ExecutionAdapter, ExternalStatus, HandoffEnvelope } from "./types";

// The app side of the n8n bridge. The page asks the site behind Access; the Mac app asks through its
// Rust shell with the website sync key. Neither ever holds an n8n token. Reports are picked up from
// the site and applied through the orchestrator, which only accepts them for the live attempt.

export interface BridgeClient {
  status(): Promise<boolean>;
  send(env: HandoffEnvelope): Promise<DispatchResult>;
  reports(since: number): Promise<{ reports: StepReportBody[]; cursor: number }>;
  /** The site's record of one step: whether it was ever sent, and its reports. */
  lookup?(idempotencyKey: string): Promise<StepLookupAnswer>;
}

export interface StepLookupAnswer {
  configured: boolean;
  dispatch?: { state: string; createdAt: string; detail?: string } | null;
  reports?: StepReportBody[];
}

/** The page gives up on the site after this long; the site gives n8n 15 s. An unanswered send is "unknown", then looked up. */
const SITE_TIMEOUT_MS = 30_000;

async function web<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(path, { credentials: "same-origin", cache: "no-store", signal: AbortSignal.timeout(SITE_TIMEOUT_MS), ...init });
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
  async lookup(idem) {
    const q = encodeURIComponent(idem);
    if (isHostedWeb()) return web<StepLookupAnswer>(`/api/n8n/steps?idem=${q}`);
    if (isTauri()) {
      const { invoke } = await import("@tauri-apps/api/core");
      return (await invoke<StepLookupAnswer | null>("live_n8n_steps", { since: 0, status: false, idem })) ?? { configured: false };
    }
    return { configured: false };
  },
};

/** A send that never reached the site would have arrived within this long; after it, no record means it never went. */
export const NOT_SENT_AFTER_MS = 2 * 60_000;

/**
 * What the site knows about one attempt. A report settles it. With no report: no record (once a
 * late request can no longer arrive) means it was never sent; an accepted send is running until the
 * step's timeout, then unknown; anything else is unknown and stays with a person.
 */
export function bridgeStatus(a: { requestedAt: string; startedAt?: string }, look: StepLookupAnswer, now: number): ExternalStatus {
  if (!look.configured || !("dispatch" in look) || !Array.isArray(look.reports)) return { state: "unknown" };
  const reports = look.reports;
  const done = [...reports].reverse().find((r) => r.kind === "succeeded" || r.kind === "failed");
  if (done?.kind === "succeeded") return { state: "succeeded", eventId: done.eventId, ...(done.output ? { output: done.output } : {}) };
  if (done?.kind === "failed") return { state: "failed", error: done.error ?? "Reported failed.", eventId: done.eventId, ...(done.transient ? { transient: true } : {}) };
  const d = look.dispatch;
  if (!d) return now - Date.parse(a.requestedAt) >= NOT_SENT_AFTER_MS ? { state: "not_sent" } : { state: "unknown", why: "The site has no record of it yet." };
  if (d.state === "refused") return { state: "failed", error: `Not sent: ${d.detail ?? "refused"}` };
  if (d.state === "accepted") return now - Date.parse(a.startedAt ?? d.createdAt) < BRIDGE_TIMEOUT_MS ? { state: "running" } : { state: "unknown", why: "n8n took the step but never reported back. The step runner keeps no run history, so check whether it shows up later; otherwise record that it didn't run." };
  return { state: "unknown", why: d.detail ?? "The site couldn't tell whether n8n started it." };
}

export const BRIDGE_NEED = "Set up the n8n bridge: the restricted step runner workflow published in n8n, and N8N_BRIDGE_TOKEN and N8N_BRIDGE_CALLBACK_TOKEN saved as Cloudflare Pages secrets (see docs/workflow-execution.md).";

/**
 * Research and planning steps through the restricted step runner. It spends model money, so it
 * counts as having side effects; the site dedupes by idempotency key, so a bounded retry can't act twice.
 */
export function bridgeAdapter(client: BridgeClient, configured: () => boolean, now: () => number = Date.now): ExecutionAdapter {
  return {
    kind: "n8n",
    sideEffects: true,
    idempotent: true,
    personStarts: false,
    available: (nodeId) => (!isBridgeStep(nodeId) ? { ok: false, need: "Only research and planning steps can be started from Atlas." } : configured() ? { ok: true } : { ok: false, need: BRIDGE_NEED }),
    dispatch: (env) => client.send(env),
    ...(client.lookup
      ? {
          status: async (a): Promise<ExternalStatus> => {
            try {
              return bridgeStatus(a, await client.lookup!(a.idempotencyKey), now());
            } catch {
              return { state: "unknown" };
            }
          },
        }
      : {}),
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
