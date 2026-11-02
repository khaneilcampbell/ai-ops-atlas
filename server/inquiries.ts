// Inquiry to Client inbox (src/inquiries/model.ts). The benjaire.com contact Worker posts each
// delivered inquiry here with the add-only AGENT_FEED_TOKEN; the signed-in page reads them at
// /api/inquiries (behind Access) and the Mac app at /api/hooks/inquiries with its sync key.
// A retried copy has the same id and is ignored. Inquiries are personal data, so anything older
// than KEEP_DAYS is deleted on each new one. The live feed gets a one-line `inquiry` event with
// the category only (no name or email), so an open page refreshes as soon as one lands.

import { INQUIRY_AGENT, KEEP_DAYS, MAX_INQUIRY_BYTES, validInquiry, type Inquiry } from "../src/inquiries/model";
import { replyState, type ReplyEnv } from "./inquiryReply";
import { bearerOk, ensureSchema as ensureFeed, type D1, type LiveEnv } from "./live";

export const INQUIRIES_PATH = "/api/hooks/inquiries";
export const READ_LIMIT = 50;

const noStore = { "cache-control": "no-store" };
const reply = (status: number, body: unknown) => Response.json(body, { status, headers: noStore });

const SCHEMA = [
  "CREATE TABLE IF NOT EXISTS inquiries (id TEXT PRIMARY KEY, received_at TEXT NOT NULL, body TEXT NOT NULL)",
  "CREATE INDEX IF NOT EXISTS inquiries_received ON inquiries(received_at)",
];

const ready = new WeakSet<D1>();
async function ensureSchema(db: D1) {
  if (ready.has(db)) return;
  await db.batch(SCHEMA.map((s) => db.prepare(s)));
  ready.add(db);
}

/** POST /api/hooks/inquiries: one inquiry from the contact Worker. Add-only; it can't read anything back. */
export async function receiveInquiry(req: Request, env: LiveEnv, now = Date.now()): Promise<Response> {
  if (!env.LIVE || !env.AGENT_FEED_TOKEN) return reply(503, { message: "The inquiry inbox isn't set up on the site yet (LIVE binding or AGENT_FEED_TOKEN missing)." });
  if (!bearerOk(req, env.AGENT_FEED_TOKEN)) return reply(401, { message: "The key doesn't match the site's AGENT_FEED_TOKEN." });
  if (Number(req.headers.get("content-length") ?? 0) > MAX_INQUIRY_BYTES) return reply(413, { message: "Payload too large." });
  const text = await req.text();
  if (text.length > MAX_INQUIRY_BYTES) return reply(413, { message: "Payload too large." });
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return reply(400, { message: "Body isn't JSON." });
  }
  if (!validInquiry(body)) return reply(400, { message: "Not a valid inquiry (see src/inquiries/model.ts)." });
  const i: Inquiry = {
    id: body.id,
    received_at: new Date(Date.parse(body.received_at)).toISOString(),
    category: body.category,
    category_label: body.category_label,
    name: body.name,
    email: body.email,
    company: body.company,
    message: body.message,
    host: body.host,
  };
  const db = env.LIVE;
  await ensureSchema(db);
  await ensureFeed(db);
  const at = new Date(now).toISOString();
  const cutoff = new Date(now - KEEP_DAYS * 86_400_000).toISOString();
  await db.batch([
    db.prepare("INSERT OR IGNORE INTO inquiries (id, received_at, body) VALUES (?, ?, ?)").bind(i.id, i.received_at, JSON.stringify(i)),
    db.prepare("DELETE FROM inquiries WHERE received_at < ?").bind(cutoff),
    db.prepare("INSERT INTO events (at, source, kind, repo, delivery, body) VALUES (?, ?, ?, ?, ?, ?)").bind(at, "agent", "inquiry", null, null, JSON.stringify({ agent: INQUIRY_AGENT, detail: `New ${i.category_label} inquiry` })),
  ]);
  return reply(202, { stored: 1 });
}

/** The newest inquiries, newest first. */
export async function readInquiries(env: LiveEnv & ReplyEnv): Promise<Response> {
  if (!env.LIVE) return reply(200, { configured: false, reply: { enabled: false }, inquiries: [] });
  await ensureSchema(env.LIVE);
  const { results } = await env.LIVE.prepare("SELECT body FROM inquiries ORDER BY received_at DESC LIMIT ?").bind(READ_LIMIT).all<{ body: string }>();
  const inquiries: Inquiry[] = [];
  for (const r of results) {
    const body = JSON.parse(r.body);
    if (validInquiry(body)) inquiries.push(body);
  }
  return reply(200, { configured: true, reply: replyState(env), inquiries });
}

/** GET /api/hooks/inquiries: the same list for the Mac app, with its sync key instead of Access. */
export async function readInquiriesForApp(req: Request, env: LiveEnv & ReplyEnv): Promise<Response> {
  if (!env.USAGE_SYNC_TOKEN) return reply(503, { message: "Live updates aren't set up on the site yet (USAGE_SYNC_TOKEN missing)." });
  if (!bearerOk(req, env.USAGE_SYNC_TOKEN)) return reply(401, { message: "The sync key doesn't match the site's USAGE_SYNC_TOKEN." });
  return readInquiries(env);
}
