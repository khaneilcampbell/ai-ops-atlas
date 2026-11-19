// Starting allow-listed n8n workflows from Atlas (Task Center). The read-only n8n API key
// (server/n8n.ts) is not used or widened: each startable workflow has its own "Atlas Start" webhook
// in n8n, and the site signs every request to it.
//
//   POST /api/n8n/start            the signed-in page (Access) asks the site to start one
//   POST /api/hooks/n8n-start      the Mac app asks the same, with its sync key, after Touch ID
//   GET  same paths ?status=1      is starting set up, and which workflows
//   GET  same paths ?idem=<key>    the site's record of one start
//
// What the site checks before anything leaves: the workflow is on the allow-list
// (src/n8n/startable.ts), the input matches that workflow's schema, the emergency stop is off, the
// idempotency key was never used, and the daily caps (per workflow and in total) aren't reached. The
// key is recorded before the send, so the same start can't go out twice, even from two devices.
//
// The signature: one HS256 token per request, signed with N8N_START_SECRET (a Pages secret, never
// in the browser or the repository, and saved in n8n as the "Atlas start (JWT)" credential). It
// names the workflow (aud), the start (jti), expires after TOKEN_TTL_SEC, and carries the SHA-256
// of the exact payload, so a token seen in n8n's execution log can't start anything else or start
// again later. n8n checks the signature and expiry itself; its "Verify Atlas Start" step checks the
// rest and the input again.

import { checkStartInput, KEEP_DAYS, START_TIMEOUT_MS, startableByKey, startPath, TOKEN_TTL_SEC, TOTAL_DAILY_CAP, validIdem, type StartAnswer, type StartableWorkflow } from "../src/n8n/startable";
import { bearerOk, type D1 } from "./live";
import { instanceOf } from "./n8n";
import { stopRefusal } from "./opsControl";
import { reply } from "./http";

export interface StartEnv {
  LIVE?: D1;
  N8N_BASE_URL?: string;
  /** Signs every start. At least 32 characters. The same value is the n8n "Atlas start (JWT)" credential's passphrase. */
  N8N_START_SECRET?: string;
  /** The Mac app's sync key, for /api/hooks/n8n-start. */
  USAGE_SYNC_TOKEN?: string;
}

type Fetcher = typeof fetch;
const DAY_MS = 86_400_000;
const MAX_BODY = 40_000;

const SCHEMA = [
  "CREATE TABLE IF NOT EXISTS n8n_starts (idem TEXT PRIMARY KEY, workflow TEXT NOT NULL, task_id TEXT, created_at TEXT NOT NULL, state TEXT NOT NULL, detail TEXT, execution_id TEXT)",
  "CREATE INDEX IF NOT EXISTS n8n_starts_at ON n8n_starts(created_at)",
];
const ready = new WeakSet<D1>();
async function ensureSchema(db: D1) {
  if (ready.has(db)) return;
  await db.batch(SCHEMA.map((s) => db.prepare(s)));
  ready.add(db);
}

export const startConfigured = (env: StartEnv) => !!env.LIVE && (env.N8N_START_SECRET ?? "").trim().length >= 32;

const b64url = (bytes: Uint8Array) => {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
const utf8 = (s: string) => new TextEncoder().encode(s);

export async function sha256(s: string): Promise<string> {
  return b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", utf8(s))));
}

export interface StartClaims {
  iss: "atlas-site";
  aud: string;
  jti: string;
  task?: string;
  iat: number;
  exp: number;
  sha: string;
}

/** One HS256 token (RFC 7519) for one start. */
export async function signStart(secret: string, claims: StartClaims): Promise<string> {
  const head = b64url(utf8(JSON.stringify({ alg: "HS256", typ: "JWT" })));
  const body = b64url(utf8(JSON.stringify(claims)));
  const key = await crypto.subtle.importKey("raw", utf8(secret.trim()), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, utf8(`${head}.${body}`)));
  return `${head}.${body}.${b64url(sig)}`;
}

function changesOf(res: unknown): number | undefined {
  const r = res as { meta?: { changes?: unknown }; changes?: unknown } | null;
  const n = r?.meta?.changes ?? r?.changes;
  return typeof n === "number" || typeof n === "bigint" ? Number(n) : undefined;
}

const executionUrl = (env: StartEnv, w: StartableWorkflow, id: string) => `${instanceOf(env)}/workflow/${w.workflowId}/executions/${encodeURIComponent(id)}`;

/** Starts one allow-listed workflow. The caller is already authenticated (Access, or the sync key). */
export async function startWorkflow(req: Request, env: StartEnv, fetcher: Fetcher = fetch, now = Date.now()): Promise<Response> {
  const refuse = (status: number, error: string) => reply(status, { state: "refused", error } satisfies StartAnswer);
  if (!startConfigured(env)) return refuse(503, "Starting n8n workflows isn't set up on the site yet (N8N_START_SECRET missing or shorter than 32 characters).");
  if (Number(req.headers.get("content-length") ?? 0) > MAX_BODY) return refuse(413, "Too large.");
  const text = await req.text();
  if (text.length > MAX_BODY) return refuse(413, "Too large.");
  let body: { workflow?: unknown; input?: unknown; idempotencyKey?: unknown; taskId?: unknown };
  try {
    body = JSON.parse(text);
  } catch {
    return refuse(400, "The body isn't JSON.");
  }
  const w = typeof body?.workflow === "string" ? startableByKey(body.workflow) : undefined;
  if (!w) return refuse(400, `${String(body?.workflow)} isn't on Atlas's start list, so it can't be started from Atlas.`);
  if (!validIdem(body.idempotencyKey)) return refuse(400, "Bad idempotency key.");
  const taskId = typeof body.taskId === "string" && /^[\w-]{1,80}$/.test(body.taskId) ? body.taskId : undefined;
  const checked = checkStartInput(w, body.input);
  if (!checked.ok) return refuse(400, checked.error);
  const idem = body.idempotencyKey;
  const db = env.LIVE!;
  await ensureSchema(db);
  // The emergency stop first, so a retried request can't slip through; fails closed.
  const stopped = await stopRefusal(db);
  if (stopped) return refuse(423, stopped);
  await db.prepare("DELETE FROM n8n_starts WHERE created_at < ?").bind(new Date(now - KEEP_DAYS * DAY_MS).toISOString()).run();
  const prior = (await db.prepare("SELECT workflow, state, detail, execution_id FROM n8n_starts WHERE idem = ?").bind(idem).all<{ workflow: string; state: string; detail: string | null; execution_id: string | null }>()).results[0];
  if (prior) {
    if (prior.workflow !== w.key) return refuse(409, "That key was already used for another workflow.");
    const state = prior.state === "accepted" || prior.state === "refused" ? prior.state : "unknown";
    return reply(200, { state, duplicate: true, ...(prior.detail ? { error: prior.detail } : {}), ...(prior.execution_id ? { executionId: prior.execution_id, executionUrl: executionUrl(env, w, prior.execution_id) } : {}) } satisfies StartAnswer);
  }
  const since = new Date(now - DAY_MS).toISOString();
  const counts = (await db.prepare("SELECT workflow, COUNT(*) AS n FROM n8n_starts WHERE created_at >= ? AND state != 'refused' GROUP BY workflow").bind(since).all<{ workflow: string; n: number }>()).results;
  const mine = Number(counts.find((c) => c.workflow === w.key)?.n ?? 0);
  const total = counts.reduce((s, c) => s + Number(c.n), 0);
  if (mine >= w.dailyCap) return refuse(429, `${w.name} was already started ${w.dailyCap} times in the last 24 hours. Try again tomorrow.`);
  if (total >= TOTAL_DAILY_CAP) return refuse(429, `Atlas already started ${TOTAL_DAILY_CAP} n8n workflows in the last 24 hours. Try again tomorrow.`);
  // The insert is the claim: of two requests with the same key, only one inserts and sends.
  const claim = await db.prepare("INSERT OR IGNORE INTO n8n_starts (idem, workflow, task_id, created_at, state) VALUES (?, ?, ?, ?, 'sending')").bind(idem, w.key, taskId ?? null, new Date(now).toISOString()).run();
  if (changesOf(claim) === 0) return reply(200, { state: "unknown", error: "Another request is starting this right now.", duplicate: true } satisfies StartAnswer);

  const payload = JSON.stringify(checked.input);
  const iat = Math.floor(now / 1000);
  const token = await signStart(env.N8N_START_SECRET!, { iss: "atlas-site", aud: w.key, jti: idem, ...(taskId ? { task: taskId } : {}), iat, exp: iat + TOKEN_TTL_SEC, sha: await sha256(payload) });
  let answer: StartAnswer;
  try {
    const r = await fetcher(`${instanceOf(env)}/webhook/${startPath(w)}`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ payload }),
      signal: AbortSignal.timeout(START_TIMEOUT_MS),
    });
    const res = (await r.json().catch(() => null)) as { accepted?: unknown; executionId?: unknown; reason?: unknown } | null;
    const execId = res && (typeof res.executionId === "string" || typeof res.executionId === "number") ? String(res.executionId).slice(0, 40) : undefined;
    if (r.ok && res?.accepted === true) answer = { state: "accepted", ...(execId ? { executionId: execId, executionUrl: executionUrl(env, w, execId) } : {}) };
    else if (r.status === 422) answer = { state: "refused", error: `n8n refused it: ${typeof res?.reason === "string" ? res.reason.slice(0, 200) : "the input or signature didn't pass its check"}.` };
    else if (r.status === 404) answer = { state: "refused", error: `n8n doesn't know the webhook atlas-start-${w.key}. Is ${w.name} published with its Atlas Start node?` };
    else if (r.status === 401 || r.status === 403) answer = { state: "refused", error: "n8n didn't accept the signature. The n8n credential \"Atlas start (JWT)\" must hold the same value as the site's N8N_START_SECRET." };
    else if (r.ok) answer = { state: "unknown", error: `n8n answered ${r.status} without saying it started.` };
    else if (r.status >= 400 && r.status < 500 && r.status !== 408 && r.status !== 429) answer = { state: "refused", error: `n8n refused it (${r.status}).` };
    else answer = { state: "unknown", error: `n8n answered ${r.status}; it may or may not have started. Check its executions before trying again.` };
  } catch (e) {
    answer = { state: "unknown", error: `No clear answer from n8n: ${e instanceof Error ? e.message : String(e)}. Check its executions before trying again.` };
  }
  await db.prepare("UPDATE n8n_starts SET state = ?, detail = ?, execution_id = ? WHERE idem = ?").bind(answer.state, answer.error ?? null, answer.executionId ?? null, idem).run();
  return reply(200, answer);
}

/** ?status=1: whether starting is set up and what can be started. ?idem=: one start's record. */
export async function readStarts(url: URL, env: StartEnv): Promise<Response> {
  const configured = startConfigured(env);
  const idem = url.searchParams.get("idem");
  if (idem === null || !configured) return reply(200, { configured });
  if (!validIdem(idem)) return reply(400, { message: "Bad idempotency key." });
  const db = env.LIVE!;
  await ensureSchema(db);
  const row = (await db.prepare("SELECT workflow, state, detail, execution_id, created_at FROM n8n_starts WHERE idem = ?").bind(idem).all<{ workflow: string; state: string; detail: string | null; execution_id: string | null; created_at: string }>()).results[0];
  if (!row) return reply(200, { configured, start: null });
  const w = startableByKey(row.workflow);
  return reply(200, {
    configured,
    start: { workflow: row.workflow, state: row.state, createdAt: row.created_at, ...(row.detail ? { detail: row.detail } : {}), ...(row.execution_id ? { executionId: row.execution_id, ...(w ? { executionUrl: executionUrl(env, w, row.execution_id) } : {}) } : {}) },
  });
}

/** The Mac app's routes: the same, with the sync key instead of Access. */
export async function startForApp(req: Request, env: StartEnv, fetcher: Fetcher = fetch): Promise<Response> {
  if (!bearerOk(req, env.USAGE_SYNC_TOKEN)) return reply(401, { message: "The key doesn't match the site's sync key." });
  return req.method === "POST" ? startWorkflow(req, env, fetcher) : readStarts(new URL(req.url), env);
}
