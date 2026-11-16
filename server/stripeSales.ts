// Named n8n actions: the only n8n workflows Atlas can start, besides the research step runner.
// Khaneil chose this over a write-scoped n8n API key (2026-11-16): Atlas can start these by name,
// and can't edit, publish, switch on or off, or delete anything in n8n.
//
//   POST /api/n8n/sales           the signed-in page (Access) asks for Stripe sales in a range
//   POST /api/hooks/n8n-sales     the Mac app asks the same, with its sync key
//   GET  same paths               whether the action is set up
//
// The site calls the "Atlas · Sales feed" n8n workflow with the bridge key (N8N_BRIDGE_TOKEN). That
// workflow reads paid Stripe checkouts with n8n's restricted Stripe read key and answers with ids,
// amounts, refunds, fees and dates only. The site checks the answer and passes it on; it stores
// nothing. Recording a sale is still done by a person in the app.

import { MAX_FEED_BYTES, MAX_RANGE_DAYS, parseSalesFeed, SALES_FEED_PATH } from "../src/business/stripeFeed";
import { bearerOk } from "./live";
import { reply } from "./http";
import { instanceOf } from "./n8n";

export interface SalesEnv {
  N8N_BASE_URL?: string;
  /** The bridge key: the n8n webhooks' header auth (same credential as the step runner). */
  N8N_BRIDGE_TOKEN?: string;
  USAGE_SYNC_TOKEN?: string;
}

type Fetcher = typeof fetch;

/** Every n8n workflow Atlas can start by name. Nothing else can be reached from here. */
export const N8N_NAMED_ACTIONS = {
  "stripe-sales": { path: SALES_FEED_PATH, workflow: "Atlas · Sales feed", writes: "nothing (reads Stripe)" },
} as const;

const TIMEOUT_MS = 30_000;
const DAY_MS = 86_400_000;
export const salesConfigured = (env: SalesEnv) => (env.N8N_BRIDGE_TOKEN ?? "").trim().length >= 32;

/** Checks the range asked for. Only two dates come in; nothing else is passed to n8n. */
export function rangeProblem(body: unknown, now = Date.now()): { since: string; until: string } | string {
  if (!body || typeof body !== "object" || Array.isArray(body)) return "Send { since, until } as ISO dates.";
  const b = body as Record<string, unknown>;
  const since = typeof b.since === "string" ? Date.parse(b.since) : NaN;
  const until = b.until === undefined ? now : typeof b.until === "string" ? Date.parse(b.until) : NaN;
  if (Number.isNaN(since) || Number.isNaN(until)) return "Bad date.";
  if (since >= until) return "The start must be before the end.";
  if (until - since > MAX_RANGE_DAYS * DAY_MS + DAY_MS) return `At most ${MAX_RANGE_DAYS} days at a time.`;
  return { since: new Date(since).toISOString(), until: new Date(Math.min(until, now)).toISOString() };
}

/** Asks the sales feed workflow for Stripe sales. The caller is already authenticated. */
export async function fetchSales(req: Request, env: SalesEnv, fetcher: Fetcher = fetch, now = Date.now()): Promise<Response> {
  if (!salesConfigured(env)) return reply(200, { state: "unconfigured", error: "The n8n bridge key (N8N_BRIDGE_TOKEN) isn't saved on the site." });
  let body: unknown;
  try {
    const text = await req.text();
    if (text.length > 2_000) return reply(413, { state: "error", error: "Payload too large." });
    body = JSON.parse(text);
  } catch {
    return reply(400, { state: "error", error: "Body isn't JSON." });
  }
  const range = rangeProblem(body, now);
  if (typeof range === "string") return reply(400, { state: "error", error: range });
  let r: Response;
  try {
    r = await fetcher(`${instanceOf(env)}/webhook/${N8N_NAMED_ACTIONS["stripe-sales"].path}`, {
      method: "POST",
      headers: { authorization: `Bearer ${env.N8N_BRIDGE_TOKEN!.trim()}`, "content-type": "application/json" },
      body: JSON.stringify(range),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    return reply(200, { state: "error", error: `Couldn't reach n8n: ${e instanceof Error ? e.message : String(e)}` });
  }
  // n8n answers 404 for a webhook whose workflow isn't published.
  if (r.status === 404) return reply(200, { state: "unconfigured", error: "The Atlas · Sales feed workflow isn't published in n8n yet." });
  if (r.status === 401 || r.status === 403) return reply(200, { state: "error", error: "n8n refused the bridge key. Check that N8N_BRIDGE_TOKEN matches the \"Atlas bridge (webhook)\" credential." });
  if (!r.ok) return reply(200, { state: "error", error: `n8n answered ${r.status}.` });
  const text = await r.text();
  if (text.length > MAX_FEED_BYTES) return reply(200, { state: "error", error: "The sales feed's answer was too large." });
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return reply(200, { state: "error", error: "The sales feed didn't answer with JSON." });
  }
  const parsed = parseSalesFeed(json);
  if (!parsed.ok) return reply(200, { state: "error", error: parsed.error });
  return reply(200, { state: "ok", ...parsed.feed });
}

export const salesStatus = (env: SalesEnv) => reply(200, { configured: salesConfigured(env), actions: Object.keys(N8N_NAMED_ACTIONS) });

/** The Mac app's route: same as the page's, with the sync key instead of Access. */
export async function salesForApp(req: Request, env: SalesEnv, fetcher: Fetcher = fetch): Promise<Response> {
  if (!bearerOk(req, env.USAGE_SYNC_TOKEN)) return reply(401, { message: "The key doesn't match the site's sync key." });
  return req.method === "POST" ? fetchSales(req, env, fetcher) : salesStatus(env);
}
