// "Refresh registry sheet" on the Agents tab. The page asks POST /api/registry/refresh (behind
// Access), the Mac app POST /api/hooks/registry-refresh with its sync key. The site then calls the
// webhook trigger of the n8n "Atlas · Agent Registry" workflow, whose URL is the Pages secret
// N8N_REGISTRY_WEBHOOK_URL (its secret path is the key), and waits for the run to finish. Neither
// device ever sees that URL. One run per minute, so clicks can't eat the n8n run budget.

import { instanceOf, type N8nEnv } from "./n8n";
import { bearerOk } from "./live";
import type { CheckCache } from "./properties";
import { REFRESH_COOLDOWN_SEC, type RefreshResult } from "../src/n8n/registryRefresh";

export interface RefreshEnv extends N8nEnv {
  /** The Production URL of the registry workflow's "Atlas Refresh Button" webhook node. */
  N8N_REGISTRY_WEBHOOK_URL?: string;
}

type Fetcher = typeof fetch;

/** The registry run takes ~15 s; give it room, but don't hold the request forever. */
const TIMEOUT_MS = 90_000;
const CACHE_KEY = "registry-refresh";
const noStore = { "cache-control": "no-store" };
const reply = (status: number, body: RefreshResult) => Response.json(body, { status, headers: noStore });

/** The webhook URL, only when it is an https webhook on the configured n8n instance. */
export function webhookOf(env: RefreshEnv): string | null {
  const raw = env.N8N_REGISTRY_WEBHOOK_URL?.trim();
  if (!raw) return null;
  try {
    const u = new URL(raw);
    return u.origin === instanceOf(env) && u.pathname.startsWith("/webhook/") ? u.toString() : null;
  } catch {
    return null;
  }
}

export async function refreshRegistry(env: RefreshEnv, cache: CheckCache | null, fetcher: Fetcher = fetch, now = Date.now()): Promise<Response> {
  const url = webhookOf(env);
  if (!url) return reply(503, { state: "not-configured", message: "The site can't reach the registry workflow yet: N8N_REGISTRY_WEBHOOK_URL isn't set on the site." });
  const last = (await cache?.get(CACHE_KEY)) as { at?: number } | null | undefined;
  if (last?.at && now - last.at < REFRESH_COOLDOWN_SEC * 1000) {
    const wait = Math.ceil((REFRESH_COOLDOWN_SEC * 1000 - (now - last.at)) / 1000);
    return reply(429, { state: "cooldown", message: `The sheet was refreshed moments ago. Try again in ${wait} s.`, retryAfterSec: wait });
  }
  // Claim the slot before calling, so two quick clicks (or both devices) start one run.
  await cache?.put(CACHE_KEY, { at: now }, REFRESH_COOLDOWN_SEC);
  try {
    const r = await fetcher(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ source: "atlas" }), signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (r.ok) return reply(200, { state: "done", finishedAt: new Date().toISOString() });
    if (r.status === 404) return reply(502, { state: "failed", message: "n8n doesn't know the refresh webhook. Is the Atlas · Agent Registry workflow published with its webhook node?" });
    return reply(502, { state: "failed", message: `The registry workflow failed (n8n answered ${r.status}). Its run is in n8n's executions list.` });
  } catch (e) {
    const timedOut = e instanceof Error && e.name === "TimeoutError";
    return reply(502, { state: "failed", message: timedOut ? "n8n didn't finish within 90 s. The run may still complete; check the sheet in a minute." : "Couldn't reach n8n." });
  }
}

/** POST /api/hooks/registry-refresh: the same for the Mac app, with its sync key instead of Access. */
export async function refreshRegistryForApp(req: Request, env: RefreshEnv, cache: CheckCache | null, fetcher: Fetcher = fetch): Promise<Response> {
  if (!env.USAGE_SYNC_TOKEN) return reply(503, { state: "not-configured", message: "Website sync isn't set up on the site yet (USAGE_SYNC_TOKEN missing)." });
  if (!bearerOk(req, env.USAGE_SYNC_TOKEN)) return reply(401, { state: "failed", message: "The sync key doesn't match the site's USAGE_SYNC_TOKEN." });
  return refreshRegistry(env, cache, fetcher);
}
