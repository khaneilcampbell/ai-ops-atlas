// Live activity for the app and the hosted web build. GitHub sends workflow and push events to
// /api/hooks/github (signed with GITHUB_WEBHOOK_SECRET); the Mac app adds its own agents' runs
// at /api/hooks/atlas (USAGE_SYNC_TOKEN). Both land in one D1 table, and clients read whatever
// is newer than the last event they saw: the signed-in page at /api/events, the Mac app at
// /api/hooks/feed with its sync key.
//
// The /api/hooks/* routes skip the Access check (GitHub and the Mac app have no Access
// session), so each one checks its own secret and fails closed without it. Only a compact,
// read-only summary of each event is kept, never the whole payload.

import { sameSecret } from "./usage";

export interface D1Statement {
  bind(...values: unknown[]): D1Statement;
  run(): Promise<unknown>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
}

export interface D1 {
  prepare(sql: string): D1Statement;
  batch(statements: D1Statement[]): Promise<unknown>;
}

export interface LiveEnv {
  /** D1 binding for the `atlas-live` database. */
  LIVE?: D1;
  /** The webhook secret typed into the GitHub App. */
  GITHUB_WEBHOOK_SECRET?: string;
  /** The Mac app's sync key, shared with usage sync. */
  USAGE_SYNC_TOKEN?: string;
}

export const HOOKS_PREFIX = "/api/hooks/";
export const MAX_BODY = 1_000_000;
/** Events older than this are pruned; a client away longer catches up with a normal refresh. */
export const KEEP_MS = 3 * 86_400_000;
/** A client with no cursor gets the recent past, so runs already in progress show at once. */
export const BACKFILL_MS = 6 * 3_600_000;
export const PAGE = 200;
const MAX_LOCAL = 50;

export interface LiveEvent {
  id: number;
  at: string;
  source: "github" | "atlas";
  kind: string;
  repo: string | null;
  body: unknown;
}

type J = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const noStore = { "cache-control": "no-store" };
const reply = (status: number, body: unknown) => Response.json(body, { status, headers: noStore });

const SCHEMA = [
  "CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, source TEXT NOT NULL, kind TEXT NOT NULL, repo TEXT, delivery TEXT UNIQUE, body TEXT NOT NULL)",
  "CREATE INDEX IF NOT EXISTS events_at ON events(at)",
];

const ready = new WeakSet<D1>();
async function ensureSchema(db: D1) {
  if (ready.has(db)) return;
  await db.batch(SCHEMA.map((s) => db.prepare(s)));
  ready.add(db);
}

const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

/** Checks GitHub's `X-Hub-Signature-256` header against the raw body. */
export async function validSignature(secret: string, body: string, header: string | null): Promise<boolean> {
  if (!header?.startsWith("sha256=")) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = hex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)));
  return sameSecret(mac, header.slice(7));
}

const pick = (o: J | undefined, keys: string[]) => (o ? Object.fromEntries(keys.filter((k) => o[k] !== undefined).map((k) => [k, o[k]])) : undefined);

const RUN_KEYS = ["id", "run_attempt", "name", "display_title", "path", "status", "conclusion", "head_branch", "head_sha", "event", "created_at", "updated_at", "run_started_at", "html_url"];
const JOB_KEYS = ["id", "run_id", "run_attempt", "name", "workflow_name", "status", "conclusion", "head_branch", "started_at", "completed_at", "html_url"];

/** The parts of a GitHub event Atlas shows. Anything else is dropped, `null` means ignore. */
export function compactGithub(event: string, p: J): { kind: string; repo: string; body: J } | null {
  const repo = p.repository?.full_name;
  if (typeof repo !== "string") return null;
  if (event === "workflow_run" && p.workflow_run) return { kind: "workflow_run", repo, body: { action: p.action, run: pick(p.workflow_run, RUN_KEYS) } };
  if (event === "workflow_job" && p.workflow_job) return { kind: "workflow_job", repo, body: { action: p.action, job: pick(p.workflow_job, JOB_KEYS) } };
  if (event === "push" && typeof p.ref === "string") {
    const commits = (Array.isArray(p.commits) ? p.commits : []).slice(-10).map((c: J) => ({
      sha: c.id,
      message: String(c.message ?? "").split("\n")[0].slice(0, 200),
      author: c.author?.name ?? c.author?.username ?? "unknown",
      date: c.timestamp,
      url: c.url,
    }));
    return { kind: "push", repo, body: { ref: p.ref, branch: p.ref.replace(/^refs\/heads\//, ""), default_branch: p.repository?.default_branch ?? null, deleted: !!p.deleted, commits } };
  }
  return null;
}

async function insert(db: D1, rows: { at: string; source: string; kind: string; repo: string | null; delivery: string | null; body: unknown }[], now: number) {
  await ensureSchema(db);
  const cutoff = new Date(now - KEEP_MS).toISOString();
  await db.batch([
    ...rows.map((r) =>
      db.prepare("INSERT OR IGNORE INTO events (at, source, kind, repo, delivery, body) VALUES (?, ?, ?, ?, ?, ?)").bind(r.at, r.source, r.kind, r.repo, r.delivery, JSON.stringify(r.body)),
    ),
    db.prepare("DELETE FROM events WHERE at < ?").bind(cutoff),
  ]);
}

async function readBody(req: Request): Promise<string | null> {
  if (Number(req.headers.get("content-length") ?? 0) > MAX_BODY) return null;
  const text = await req.text();
  return text.length > MAX_BODY ? null : text;
}

/** POST /api/hooks/github: a webhook delivery from the GitHub App. */
export async function receiveGithub(req: Request, env: LiveEnv, now = Date.now()): Promise<Response> {
  if (!env.LIVE || !env.GITHUB_WEBHOOK_SECRET) return reply(503, { message: "Live updates aren't set up on the site yet (LIVE binding or GITHUB_WEBHOOK_SECRET missing)." });
  const text = await readBody(req);
  if (text === null) return reply(413, { message: "Payload too large." });
  if (!(await validSignature(env.GITHUB_WEBHOOK_SECRET, text, req.headers.get("x-hub-signature-256")))) return reply(401, { message: "Signature doesn't match GITHUB_WEBHOOK_SECRET." });
  const event = req.headers.get("x-github-event") ?? "";
  if (event === "ping") return reply(200, { ok: true });
  let payload: J;
  try {
    payload = JSON.parse(text);
  } catch {
    return reply(400, { message: "Body isn't JSON." });
  }
  const c = compactGithub(event, payload);
  if (!c) return reply(202, { ignored: event });
  await insert(env.LIVE, [{ at: new Date(now).toISOString(), source: "github", delivery: req.headers.get("x-github-delivery"), ...c }], now);
  return reply(202, { stored: c.kind });
}

function bearerOk(req: Request, env: LiveEnv): boolean {
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  return !!token && !!env.USAGE_SYNC_TOKEN && env.USAGE_SYNC_TOKEN.length >= 32 && sameSecret(token, env.USAGE_SYNC_TOKEN);
}

const KINDS = new Set(["intel_run"]);

/** POST /api/hooks/atlas: runs of the Mac app's own agents, sent as they change. */
export async function receiveAtlas(req: Request, env: LiveEnv, now = Date.now()): Promise<Response> {
  if (!env.LIVE || !env.USAGE_SYNC_TOKEN) return reply(503, { message: "Live updates aren't set up on the site yet (LIVE binding or USAGE_SYNC_TOKEN missing)." });
  if (!bearerOk(req, env)) return reply(401, { message: "The sync key doesn't match the site's USAGE_SYNC_TOKEN." });
  const text = await readBody(req);
  if (text === null) return reply(413, { message: "Payload too large." });
  let body: { events?: unknown };
  try {
    body = JSON.parse(text);
  } catch {
    return reply(400, { message: "Body isn't JSON." });
  }
  if (!Array.isArray(body?.events) || body.events.length > MAX_LOCAL) return reply(400, { message: `Expected an "events" array of at most ${MAX_LOCAL}.` });
  const rows = (body.events as J[]).filter((e) => e && KINDS.has(e.kind) && e.body && typeof e.body === "object");
  if (!rows.length) return reply(202, { stored: 0 });
  // The server's clock orders events; the body keeps the app's own timestamps.
  const at = new Date(now).toISOString();
  await insert(env.LIVE, rows.map((e) => ({ at, source: "atlas", kind: e.kind, repo: typeof e.repo === "string" ? e.repo : null, delivery: null, body: e.body })), now);
  return reply(202, { stored: rows.length });
}

/** Events after `after` (an id), or the recent past for a client starting fresh. */
export async function readEvents(url: URL, env: LiveEnv, now = Date.now()): Promise<Response> {
  if (!env.LIVE) return reply(200, { configured: false, cursor: null, events: [] });
  await ensureSchema(env.LIVE);
  const after = Number(url.searchParams.get("after"));
  const fresh = !url.searchParams.has("after") || !Number.isFinite(after) || after < 0;
  // Newest first so a long gap returns the latest page; flipped back to oldest first below.
  const q = fresh
    ? env.LIVE.prepare("SELECT id, at, source, kind, repo, body FROM events WHERE at >= ? ORDER BY id DESC LIMIT ?").bind(new Date(now - BACKFILL_MS).toISOString(), PAGE)
    : env.LIVE.prepare("SELECT id, at, source, kind, repo, body FROM events WHERE id > ? ORDER BY id DESC LIMIT ?").bind(after, PAGE);
  const { results } = await q.all<{ id: number; at: string; source: LiveEvent["source"]; kind: string; repo: string | null; body: string }>();
  const events: LiveEvent[] = results.reverse().map((r) => ({ ...r, body: JSON.parse(r.body) }));
  let cursor = events.length ? events[events.length - 1].id : fresh ? 0 : after;
  if (fresh && !events.length) {
    const { results: last } = await env.LIVE.prepare("SELECT MAX(id) AS id FROM events").all<{ id: number | null }>();
    cursor = last[0]?.id ?? 0;
  }
  return reply(200, { configured: true, cursor, events, gap: !fresh && results.length === PAGE });
}

/** GET /api/hooks/feed: the same feed for the Mac app, with its sync key instead of Access. */
export async function readFeed(req: Request, env: LiveEnv, now = Date.now()): Promise<Response> {
  if (!env.USAGE_SYNC_TOKEN) return reply(503, { message: "Live updates aren't set up on the site yet (USAGE_SYNC_TOKEN missing)." });
  if (!bearerOk(req, env)) return reply(401, { message: "The sync key doesn't match the site's USAGE_SYNC_TOKEN." });
  return readEvents(new URL(req.url), env, now);
}
