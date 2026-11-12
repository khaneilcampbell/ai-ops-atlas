import { isHostedWeb, isTauri } from "../lib/env";

// Refresh registry sheet: asks the site to run the n8n Agent Registry workflow now (server/registryRefresh.ts).
// The page goes through /api/registry/refresh behind Access, the Mac app through its Rust shell with the
// website sync key. The n8n webhook URL stays on the site.

export const REGISTRY_SHEET_URL = "https://docs.google.com/spreadsheets/d/1OcCD-k4ob_9lwpiQN3CazE7mkgQz0ExCzqLtHXrPAQA/edit";
export const REGISTRY_WORKFLOW_URL = "https://khancam15.app.n8n.cloud/workflow/JCjTTvb7qZLpVXhs";
/** One run per minute, on the site and on the button, to protect the n8n monthly run budget. */
export const REFRESH_COOLDOWN_SEC = 60;

export type RefreshResult =
  | { state: "done"; finishedAt: string }
  | { state: "cooldown"; message: string; retryAfterSec: number }
  | { state: "not-configured" | "failed"; message: string };

export type RefreshView =
  | { state: "idle" }
  | { state: "running"; startedAt: number }
  | { state: "done"; finishedAt: string }
  | { state: "failed"; message: string; at: number };

/** Seconds until the button may be pressed again, counted from the last press. */
export function cooldownLeft(lastPress: number | null, now: number): number {
  if (lastPress == null) return 0;
  return Math.max(0, Math.ceil((lastPress + REFRESH_COOLDOWN_SEC * 1000 - now) / 1000));
}

/** Turns the site's answer into what the button shows. A cooldown is shown as a failure with its reason. */
export function viewOf(r: RefreshResult, now: number): RefreshView {
  return r.state === "done" ? { state: "done", finishedAt: r.finishedAt } : { state: "failed", message: r.message, at: now };
}

async function parse(r: Response): Promise<RefreshResult> {
  const body = (await r.json().catch(() => null)) as RefreshResult | { message?: string } | null;
  if (body && "state" in body) return body;
  return { state: "failed", message: body?.message ?? `The site answered ${r.status}.` };
}

/** Runs the registry workflow and waits for it to finish. Never throws. */
export async function requestRegistryRefresh(): Promise<RefreshResult> {
  try {
    if (isHostedWeb()) {
      return parse(await fetch("/api/registry/refresh", { method: "POST", credentials: "same-origin", cache: "no-store", headers: { "content-type": "application/json" }, body: "{}" }));
    }
    if (isTauri()) {
      const { invoke } = await import("@tauri-apps/api/core");
      const r = await invoke<RefreshResult | null>("registry_refresh");
      return r ?? { state: "not-configured", message: "The refresh goes through website sync. Set it up in Settings → Website sync." };
    }
    return { state: "not-configured", message: "Refresh runs from the hosted site and the Mac app, not this preview." };
  } catch (e) {
    return { state: "failed", message: e instanceof Error ? e.message : String(e) };
  }
}
