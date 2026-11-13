// Model usage reported by agents that run outside the Mac app (the GitHub Actions agents:
// Merge Flow, Design Consistency, Opportunity Scout, ...). After each model call an agent posts
// the token counts the provider reported, its model and an estimated cost to /api/hooks/usage
// with the add-only AGENT_FEED_TOKEN. The signed-in page reads them at /api/usage/agents
// (behind Access) and the Mac app at /api/hooks/usage with its sync key, and the API Usage tab
// totals them next to the Mac's own runs. Numbers only: no prompt, no output, never a key.

import { parseImport, toSyncRows } from "../src/usage/model";
import { bearerOk, type D1, type LiveEnv } from "./live";
import { reply } from "./http";

export const AGENT_USAGE_PATH = "/api/hooks/usage";
/** Rows per POST: one agent run makes a handful of calls at most. */
export const MAX_ROWS_PER_POST = 50;
export const MAX_POST_BYTES = 64_000;
/** Rows kept; the oldest go first. Plenty for the 30-day view at the agents' schedules. */
export const KEEP_ROWS = 5_000;
export const READ_LIMIT = 2_000;


const SCHEMA = [
  "CREATE TABLE IF NOT EXISTS agent_usage (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, agent TEXT NOT NULL, body TEXT NOT NULL)",
  "CREATE INDEX IF NOT EXISTS agent_usage_at ON agent_usage(at)",
];

const ready = new WeakSet<D1>();
async function ensureSchema(db: D1) {
  if (ready.has(db)) return;
  await db.batch(SCHEMA.map((s) => db.prepare(s)));
  ready.add(db);
}

/** POST /api/hooks/usage: `{ "records": [...] }` in the import format (docs/api-usage.md). Add-only. */
export async function receiveAgentUsage(req: Request, env: LiveEnv): Promise<Response> {
  if (!env.LIVE || !env.AGENT_FEED_TOKEN) return reply(503, { message: "Agent usage isn't set up on the site yet (LIVE binding or AGENT_FEED_TOKEN missing)." });
  if (!bearerOk(req, env.AGENT_FEED_TOKEN)) return reply(401, { message: "The key doesn't match the site's AGENT_FEED_TOKEN." });
  if (Number(req.headers.get("content-length") ?? 0) > MAX_POST_BYTES) return reply(413, { message: "Payload too large." });
  const text = await req.text();
  if (text.length > MAX_POST_BYTES) return reply(413, { message: "Payload too large." });
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return reply(400, { message: "Body isn't JSON." });
  }
  const rows = body && typeof body === "object" ? (body as { records?: unknown }).records : undefined;
  if (!Array.isArray(rows) || rows.length === 0) return reply(400, { message: 'Expected an object with a non-empty "records" array.' });
  if (rows.length > MAX_ROWS_PER_POST) return reply(413, { message: `At most ${MAX_ROWS_PER_POST} records per post.` });
  // The same check an imported file gets; only known fields survive, so nothing else is stored.
  const { records, skipped } = parseImport(JSON.stringify(rows), "agent");
  if (records.length === 0) return reply(400, { message: "No valid usage records (see docs/api-usage.md)." });
  const db = env.LIVE;
  await ensureSchema(db);
  await db.batch([
    ...toSyncRows(records).map((r) => db.prepare("INSERT INTO agent_usage (at, agent, body) VALUES (?, ?, ?)").bind(r.at, r.agent, JSON.stringify(r))),
    db.prepare("DELETE FROM agent_usage WHERE id NOT IN (SELECT id FROM agent_usage ORDER BY id DESC LIMIT ?)").bind(KEEP_ROWS),
  ]);
  return reply(202, { stored: records.length, skipped });
}

/** The newest reported rows, newest first, for the signed-in page. */
export async function readAgentUsage(env: LiveEnv): Promise<Response> {
  if (!env.LIVE) return reply(200, { configured: false, records: [] });
  await ensureSchema(env.LIVE);
  const { results } = await env.LIVE.prepare("SELECT body FROM agent_usage ORDER BY at DESC LIMIT ?").bind(READ_LIMIT).all<{ body: string }>();
  const records: unknown[] = [];
  for (const r of results) {
    try {
      records.push(JSON.parse(r.body));
    } catch {
      /* a row that no longer parses is left out; the page re-validates the rest */
    }
  }
  return reply(200, { configured: true, records });
}

/** GET /api/hooks/usage: the same rows for the Mac app, with its sync key instead of Access. */
export async function readAgentUsageForApp(req: Request, env: LiveEnv): Promise<Response> {
  if (!env.USAGE_SYNC_TOKEN) return reply(503, { message: "Live updates aren't set up on the site yet (USAGE_SYNC_TOKEN missing)." });
  if (!bearerOk(req, env.USAGE_SYNC_TOKEN)) return reply(401, { message: "The sync key doesn't match the site's USAGE_SYNC_TOKEN." });
  return readAgentUsage(env);
}
