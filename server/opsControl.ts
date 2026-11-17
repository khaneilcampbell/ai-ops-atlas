import type { D1 } from "./live";
import { reply } from "./http";

// Phase 9 emergency stop, enforced on the site. While it is on, the site refuses every new n8n step
// send (server/n8nBridge.ts dispatchStep), whichever client asks. It only holds new sends: reports
// from steps already running, the live feed, alerts and the audit log keep working. Only the signed-in
// page (behind Cloudflare Access) can turn it on or off, and every change is logged.

export interface OpsEnv {
  LIVE?: D1;
}

const SCHEMA = [
  "CREATE TABLE IF NOT EXISTS ops_control (id INTEGER PRIMARY KEY CHECK (id = 1), active INTEGER NOT NULL, at TEXT NOT NULL, by TEXT NOT NULL, reason TEXT NOT NULL)",
  "CREATE TABLE IF NOT EXISTS ops_control_log (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, by TEXT NOT NULL, active INTEGER NOT NULL, reason TEXT NOT NULL)",
];

const ready = new WeakSet<D1>();
async function ensure(db: D1) {
  if (ready.has(db)) return;
  await db.batch(SCHEMA.map((s) => db.prepare(s)));
  ready.add(db);
}

export interface StopState {
  active: boolean;
  at: string | null;
  by: string | null;
  reason: string;
}

export async function readStop(db: D1): Promise<StopState> {
  await ensure(db);
  const row = (await db.prepare("SELECT active, at, by, reason FROM ops_control WHERE id = 1").all<{ active: number; at: string; by: string; reason: string }>()).results[0];
  return row ? { active: row.active === 1, at: row.at, by: row.by, reason: row.reason } : { active: false, at: null, by: null, reason: "" };
}

/** Why a new step send is refused, or null. Fails closed: if the stop can't be read, nothing is sent. */
export async function stopRefusal(db: D1): Promise<string | null> {
  try {
    const s = await readStop(db);
    return s.active ? `Emergency stop is on${s.reason ? ` (${s.reason})` : ""}. Khaneil resumes it in Mission Control.` : null;
  } catch {
    return "The emergency stop state couldn't be read, so nothing is sent.";
  }
}

const clean = (s: unknown) => (typeof s === "string" ? s.replace(/\s+/g, " ").trim().slice(0, 200) : "");

/** GET: the stop state. POST {active, reason}: change it. The route is behind Access; the email comes from Access. */
export async function opsControl(req: Request, env: OpsEnv, now = Date.now()): Promise<Response> {
  if (!env.LIVE) return reply(503, { message: "The site's LIVE database isn't bound, so the site-wide stop isn't available." });
  if (req.method === "GET") return reply(200, await readStop(env.LIVE));
  if (req.method !== "POST") return reply(405, { message: "Use GET or POST." });
  if (Number(req.headers.get("content-length") ?? 0) > 2_000) return reply(413, { message: "Payload too large." });
  let body: unknown;
  try {
    body = JSON.parse((await req.text()).slice(0, 2_000));
  } catch {
    return reply(400, { message: "Body isn't JSON." });
  }
  const b = body as { active?: unknown; reason?: unknown };
  if (typeof b.active !== "boolean") return reply(400, { message: "Say active: true or false." });
  const by = clean(req.headers.get("cf-access-authenticated-user-email")) || "Khaneil";
  const at = new Date(now).toISOString();
  const reason = clean(b.reason);
  await ensure(env.LIVE);
  await env.LIVE.batch([
    env.LIVE.prepare("INSERT INTO ops_control (id, active, at, by, reason) VALUES (1, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET active = excluded.active, at = excluded.at, by = excluded.by, reason = excluded.reason").bind(b.active ? 1 : 0, at, by, reason),
    env.LIVE.prepare("INSERT INTO ops_control_log (at, by, active, reason) VALUES (?, ?, ?, ?)").bind(at, by, b.active ? 1 : 0, reason),
  ]);
  return reply(200, await readStop(env.LIVE));
}
