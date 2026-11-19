import { isHostedWeb, isTauri } from "../lib/env";
import type { StartAnswer, StartInput } from "./startable";

// The app side of starting n8n workflows. The page asks the site behind Access; the Mac app asks
// through its Rust shell, which asks for Touch ID and then calls the site with the website sync key.
// Neither ever holds the signing secret or an n8n key.

export interface StartRequest {
  workflow: string;
  input: StartInput;
  idempotencyKey: string;
  taskId?: string;
}

/** The page gives up on the site after this long; the site gives n8n 15 s. */
const SITE_TIMEOUT_MS = 30_000;

async function web<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(path, { credentials: "same-origin", cache: "no-store", signal: AbortSignal.timeout(SITE_TIMEOUT_MS), ...init });
  const body = (await r.json().catch(() => null)) as T | null;
  if (body && typeof body === "object" && ("state" in body || "configured" in body)) return body;
  throw new Error((body as { message?: string } | null)?.message ?? `The site answered ${r.status}.`);
}

/** Whether the site has the signing secret. False when neither the page nor the Mac app can ask. */
export async function startStatus(): Promise<boolean> {
  if (isHostedWeb()) return (await web<{ configured: boolean }>("/api/n8n/start?status=1")).configured;
  if (isTauri()) {
    const { invoke } = await import("@tauri-apps/api/core");
    return !!(await invoke<{ configured: boolean } | null>("live_n8n_start_status"))?.configured;
  }
  return false;
}

/** Asks the site to start one workflow. On the Mac, Touch ID comes first. */
export async function startN8n(req: StartRequest, workflowName: string): Promise<StartAnswer> {
  if (isHostedWeb()) return web<StartAnswer>("/api/n8n/start", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(req) });
  if (isTauri()) {
    const { invoke } = await import("@tauri-apps/api/core");
    return (await invoke<StartAnswer | null>("live_n8n_start", { request: req, name: workflowName })) ?? { state: "refused", error: "Website sync isn't set up in the Mac app (Settings → Website sync)." };
  }
  return { state: "refused", error: "n8n workflows start from the hosted site or the Mac app." };
}
