// Send a reply to a website inquiry from Atlas, as the designed Benjaire email, with a copy to
// KC's Gmail. KC reviews the text in Atlas and presses Send; nothing here sends on its own.
// Two entry points with the same body: /api/inquiries/reply (signed-in page, behind Access) and
// /api/hooks/inquiries/reply (Mac app, sync key). The recipient is read from the stored inquiry,
// never from the request, so the endpoint can only answer people who wrote in. Off until
// RESEND_API_KEY, REPLY_FROM and REPLY_BCC are set on the site.

import { brandedEmailHtml } from "../src/inquiries/emailHtml";
import { validInquiry, type Inquiry } from "../src/inquiries/model";
import { bearerOk, type D1, type LiveEnv } from "./live";

export interface ReplyEnv {
  /** Sender on a domain verified in Resend, for example "Benjaire <contact@benjaire.com>". */
  REPLY_FROM?: string;
  /** Where KC's copy goes (the Gmail inbox). */
  REPLY_BCC?: string;
  /** Where the customer's answer should land. Defaults to the sender. */
  REPLY_REPLY_TO?: string;
}

export const MAX_SUBJECT = 200;
export const MAX_BODY_CHARS = 10_000;
export const DAILY_CAP = 50;
const TIMEOUT_MS = 10_000;

const noStore = { "cache-control": "no-store" };
const out = (status: number, body: unknown) => Response.json(body, { status, headers: noStore });

type Env = LiveEnv & ReplyEnv;

export const replyConfigured = (env: Env) => !!(env.RESEND_API_KEY && env.REPLY_FROM && env.REPLY_BCC);

const SCHEMA = "CREATE TABLE IF NOT EXISTS inquiry_replies (key TEXT PRIMARY KEY, inquiry_id TEXT NOT NULL, sent_at TEXT NOT NULL, status TEXT NOT NULL)";
const ready = new WeakSet<D1>();
async function ensureSchema(db: D1) {
  if (ready.has(db)) return;
  await db.prepare(SCHEMA).run();
  ready.add(db);
}

interface Request_ {
  id: string;
  key: string;
  subject: string;
  body: string;
}

export function validReply(v: unknown): v is Request_ {
  if (!v || typeof v !== "object") return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r.id === "string" && r.id.length > 0 && r.id.length <= 100 &&
    typeof r.key === "string" && /^[A-Za-z0-9_-]{8,80}$/.test(r.key) &&
    typeof r.subject === "string" && r.subject.trim().length > 0 && r.subject.length <= MAX_SUBJECT && !/[\r\n]/.test(r.subject) &&
    typeof r.body === "string" && r.body.trim().length > 0 && r.body.length <= MAX_BODY_CHARS
  );
}

/** What Resend gets. Exported so the tests can check the shape without a network. */
export function resendPayload(env: Env, inquiry: Inquiry, r: Request_) {
  return {
    from: env.REPLY_FROM,
    to: [inquiry.email],
    bcc: [env.REPLY_BCC],
    reply_to: env.REPLY_REPLY_TO || undefined,
    subject: r.subject.trim(),
    html: brandedEmailHtml(r.body),
    text: r.body,
  };
}

/** Whether replies can be sent from this site, for the inbox to show or hide the Send button. */
export const replyState = (env: Env) => ({ enabled: replyConfigured(env) && !!env.LIVE });

export async function sendReply(req: Request, env: Env, fetcher: typeof fetch = fetch, now = Date.now()): Promise<Response> {
  if (!env.LIVE || !replyConfigured(env)) return out(503, { message: "Sending from Atlas isn't set up on the site yet (RESEND_API_KEY, REPLY_FROM and REPLY_BCC)." });
  const text = await req.text();
  if (text.length > MAX_BODY_CHARS + 2_000) return out(413, { message: "Reply too large." });
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return out(400, { message: "Body isn't JSON." });
  }
  if (!validReply(body)) return out(400, { message: `Needs id, key, a one-line subject (up to ${MAX_SUBJECT} characters) and a body (up to ${MAX_BODY_CHARS}).` });
  const db = env.LIVE;
  await ensureSchema(db);
  const row = (await db.prepare("SELECT body FROM inquiries WHERE id = ?").bind(body.id).all<{ body: string }>()).results[0];
  let inquiry: unknown;
  try {
    inquiry = row ? JSON.parse(row.body) : null;
  } catch {
    inquiry = null;
  }
  if (!validInquiry(inquiry)) return out(404, { message: "That inquiry isn't in the inbox (it may be older than the keep period)." });

  const dup = (await db.prepare("SELECT status FROM inquiry_replies WHERE key = ?").bind(body.key).all<{ status: string }>()).results[0];
  if (dup?.status === "sent") return out(200, { sent: true, duplicate: true });
  const dayAgo = new Date(now - 86_400_000).toISOString();
  const count = (await db.prepare("SELECT COUNT(*) AS n FROM inquiry_replies WHERE sent_at > ? AND status = 'sent'").bind(dayAgo).all<{ n: number }>()).results[0];
  if ((count?.n ?? 0) >= DAILY_CAP) return out(429, { message: `Stopped at ${DAILY_CAP} replies in 24 hours as a safety limit.` });

  let ok = false;
  let detail = "";
  try {
    const r = await fetcher("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, "content-type": "application/json", "idempotency-key": `atlas-reply-${body.key}` },
      body: JSON.stringify(resendPayload(env, inquiry, body)),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    ok = r.ok;
    if (!ok) detail = ((await r.json().catch(() => null)) as { message?: string } | null)?.message ?? `Resend answered ${r.status}.`;
  } catch {
    detail = "Couldn't reach the mail service.";
  }
  if (!ok) return out(502, { message: detail || "The mail service refused it." });
  await db.prepare("INSERT OR REPLACE INTO inquiry_replies (key, inquiry_id, sent_at, status) VALUES (?, ?, ?, 'sent')").bind(body.key, body.id, new Date(now).toISOString()).run();
  return out(200, { sent: true, to: inquiry.email });
}

/** The Mac app's route: same send, checked with the sync key instead of Access. */
export async function sendReplyForApp(req: Request, env: Env, fetcher: typeof fetch = fetch): Promise<Response> {
  if (!env.USAGE_SYNC_TOKEN) return out(503, { message: "Live updates aren't set up on the site yet (USAGE_SYNC_TOKEN missing)." });
  if (!bearerOk(req, env.USAGE_SYNC_TOKEN)) return out(401, { message: "The sync key doesn't match the site's USAGE_SYNC_TOKEN." });
  return sendReply(req, env, fetcher);
}
