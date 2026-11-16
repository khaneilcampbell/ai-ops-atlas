// The n8n bridge: lets Atlas start allow-listed research and planning steps in one restricted n8n
// workflow, and take that workflow's reports back. Nothing here can start any other n8n workflow,
// and the read-only n8n API key (server/n8n.ts) is not used or widened.
//
//   POST /api/n8n/steps            the signed-in page (Access) asks the site to send a step
//   POST /api/hooks/n8n-steps      the Mac app asks the same, with its sync key
//   GET  same paths ?since=<id>    reports to pick up (and ?status=1: is the bridge set up)
//   POST /api/hooks/n8n-report     the step runner posts a report, with its own callback key
//
// Two secrets, one per direction, both only on the site and in n8n credentials: N8N_BRIDGE_TOKEN
// (Atlas -> n8n, the webhook's header auth) and N8N_BRIDGE_CALLBACK_TOKEN (n8n -> Atlas, which can
// only add reports for steps the site sent). Each send is recorded by its idempotency key before
// it goes out and is never sent twice; at most DAILY_DISPATCH_CAP sends a day. Reports must name a
// step the site sent, under the same run and attempt; each report id is stored once. Everything is
// deleted after KEEP_DAYS. Run data lives only in the private D1 database, never in GitHub.

import { DAILY_DISPATCH_CAP, dispatchProblem, KEEP_DAYS, MAX_ENVELOPE_BYTES, MAX_REPORT_BYTES, parseStepReport, STEP_RUNNER_PATH, type StepReportBody } from "../src/execution/n8nBridge";
import type { HandoffEnvelope } from "../src/execution/types";
import { bearerOk, type D1 } from "./live";
import { reply } from "./http";
import { instanceOf } from "./n8n";

export interface BridgeEnv {
  LIVE?: D1;
  N8N_BASE_URL?: string;
  /** Atlas -> n8n: the step runner webhook's header auth value. */
  N8N_BRIDGE_TOKEN?: string;
  /** n8n -> Atlas: the key the step runner uses to post reports. */
  N8N_BRIDGE_CALLBACK_TOKEN?: string;
  /** The Mac app's sync key, for /api/hooks/n8n-steps. */
  USAGE_SYNC_TOKEN?: string;
}

type Fetcher = typeof fetch;
const TIMEOUT_MS = 15_000;
const DAY_MS = 86_400_000;
const READ_LIMIT = 100;

const SCHEMA = [
  "CREATE TABLE IF NOT EXISTS n8n_dispatch (idem TEXT PRIMARY KEY, run_id TEXT NOT NULL, node_id TEXT NOT NULL, attempt_id TEXT NOT NULL, created_at TEXT NOT NULL, state TEXT NOT NULL, detail TEXT)",
  "CREATE INDEX IF NOT EXISTS n8n_dispatch_at ON n8n_dispatch(created_at)",
  "CREATE TABLE IF NOT EXISTS n8n_reports (id INTEGER PRIMARY KEY AUTOINCREMENT, event_id TEXT UNIQUE NOT NULL, idem TEXT NOT NULL, at TEXT NOT NULL, body TEXT NOT NULL)",
  "CREATE INDEX IF NOT EXISTS n8n_reports_at ON n8n_reports(at)",
];

const ready = new WeakSet<D1>();
async function ensureSchema(db: D1) {
  if (ready.has(db)) return;
  await db.batch(SCHEMA.map((s) => db.prepare(s)));
  ready.add(db);
}

const longEnough = (s?: string) => (s ?? "").trim().length >= 32;
export const bridgeConfigured = (env: BridgeEnv) => !!env.LIVE && longEnough(env.N8N_BRIDGE_TOKEN) && longEnough(env.N8N_BRIDGE_CALLBACK_TOKEN);

async function readBody(req: Request, max: number): Promise<{ ok: true; value: unknown } | { ok: false; res: Response }> {
  if (Number(req.headers.get("content-length") ?? 0) > max) return { ok: false, res: reply(413, { message: "Payload too large." }) };
  const text = await req.text();
  if (text.length > max) return { ok: false, res: reply(413, { message: "Payload too large." }) };
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false, res: reply(400, { message: "Body isn't JSON." }) };
  }
}

async function prune(db: D1, now: number) {
  const cutoff = new Date(now - KEEP_DAYS * DAY_MS).toISOString();
  await db.batch([db.prepare("DELETE FROM n8n_dispatch WHERE created_at < ?").bind(cutoff), db.prepare("DELETE FROM n8n_reports WHERE at < ?").bind(cutoff)]);
}

/** Rows a write changed, from D1's answer (meta.changes) or SQLite's (changes). Undefined when it can't tell. */
function changesOf(res: unknown): number | undefined {
  const r = res as { meta?: { changes?: unknown }; changes?: unknown } | null;
  const n = r?.meta?.changes ?? r?.changes;
  return typeof n === "number" || typeof n === "bigint" ? Number(n) : undefined;
}

export type DispatchAnswer = { state: "accepted" | "refused" | "unknown"; error?: string; duplicate?: boolean };

/** Sends one allow-listed step to the step runner. The caller is already authenticated (Access or sync key). */
export async function dispatchStep(req: Request, env: BridgeEnv, fetcher: Fetcher = fetch, now = Date.now()): Promise<Response> {
  if (!bridgeConfigured(env)) return reply(503, { state: "refused", error: "The n8n bridge isn't set up on the site (LIVE, N8N_BRIDGE_TOKEN or N8N_BRIDGE_CALLBACK_TOKEN missing)." });
  const body = await readBody(req, MAX_ENVELOPE_BYTES);
  if (!body.ok) return body.res;
  const problem = dispatchProblem(body.value);
  if (problem) return reply(400, { state: "refused", error: problem });
  const env0 = body.value as HandoffEnvelope;
  const db = env.LIVE!;
  await ensureSchema(db);
  await prune(db, now);
  const prior = (await db.prepare("SELECT state, detail FROM n8n_dispatch WHERE idem = ?").bind(env0.idempotencyKey).all<{ state: string; detail: string | null }>()).results[0];
  // A record still "sending" means an earlier request stopped mid-send: it may have gone out.
  if (prior) return reply(200, { state: prior.state === "accepted" || prior.state === "refused" ? prior.state : "unknown", ...(prior.detail ? { error: prior.detail } : {}), duplicate: true } satisfies DispatchAnswer);
  const since = new Date(now - DAY_MS).toISOString();
  const count = Number((await db.prepare("SELECT COUNT(*) AS n FROM n8n_dispatch WHERE created_at >= ? AND state != 'refused'").bind(since).all<{ n: number }>()).results[0]?.n ?? 0);
  if (count >= DAILY_DISPATCH_CAP) return reply(429, { state: "refused", error: `The daily limit of ${DAILY_DISPATCH_CAP} n8n steps is reached. Try again tomorrow.` } satisfies DispatchAnswer);
  // Record the key before sending. A second request with the same key is answered from here. The
  // insert is the claim: two requests that both passed the check above can't both send, because
  // only one of them inserts the row.
  const claim = await db.prepare("INSERT OR IGNORE INTO n8n_dispatch (idem, run_id, node_id, attempt_id, created_at, state) VALUES (?, ?, ?, ?, ?, 'sending')").bind(env0.idempotencyKey, env0.runId, env0.nodeId, env0.attemptId!, new Date(now).toISOString()).run();
  if (changesOf(claim) === 0) return reply(200, { state: "unknown", error: "Another request is sending this step right now.", duplicate: true } satisfies DispatchAnswer);
  let answer: DispatchAnswer;
  try {
    const r = await fetcher(`${instanceOf(env)}/webhook/${STEP_RUNNER_PATH}`, {
      method: "POST",
      headers: { authorization: `Bearer ${env.N8N_BRIDGE_TOKEN!.trim()}`, "content-type": "application/json", "idempotency-key": env0.idempotencyKey },
      body: JSON.stringify(env0),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (r.ok) answer = { state: "accepted" };
    else if (r.status >= 400 && r.status < 500 && r.status !== 408 && r.status !== 429) answer = { state: "refused", error: `n8n refused the step (${r.status}).` };
    else answer = { state: "unknown", error: `n8n answered ${r.status}; the step may or may not have started.` };
  } catch (e) {
    answer = { state: "unknown", error: `No clear answer from n8n: ${e instanceof Error ? e.message : String(e)}` };
  }
  await db.prepare("UPDATE n8n_dispatch SET state = ?, detail = ? WHERE idem = ?").bind(answer.state, answer.error ?? null, env0.idempotencyKey).run();
  return reply(200, answer);
}

/** The step runner's report. Only for a step the site sent, under the same run and attempt; each report id once. */
export async function receiveStepReport(req: Request, env: BridgeEnv, now = Date.now()): Promise<Response> {
  if (!bridgeConfigured(env)) return reply(503, { message: "The n8n bridge isn't set up on the site." });
  if (!bearerOk(req, env.N8N_BRIDGE_CALLBACK_TOKEN)) return reply(401, { message: "The key doesn't match the site's N8N_BRIDGE_CALLBACK_TOKEN." });
  const body = await readBody(req, MAX_REPORT_BYTES);
  if (!body.ok) return body.res;
  const parsed = parseStepReport(body.value);
  if (!parsed.ok) return reply(400, { message: parsed.error });
  const r = parsed.report;
  const db = env.LIVE!;
  await ensureSchema(db);
  const sent = (await db.prepare("SELECT run_id, node_id, attempt_id FROM n8n_dispatch WHERE idem = ?").bind(r.idempotencyKey).all<{ run_id: string; node_id: string; attempt_id: string }>()).results[0];
  if (!sent) return reply(404, { message: "Atlas didn't send this step." });
  if (sent.run_id !== r.runId || sent.node_id !== r.nodeId || sent.attempt_id !== r.attemptId) return reply(409, { message: "The report doesn't match the step Atlas sent." });
  const stored = { ...r, receivedAt: new Date(now).toISOString() };
  await db.prepare("INSERT OR IGNORE INTO n8n_reports (event_id, idem, at, body) VALUES (?, ?, ?, ?)").bind(r.eventId, r.idempotencyKey, stored.receivedAt, JSON.stringify(stored)).run();
  return reply(202, { stored: true });
}

/** Reports after `since`, oldest first, for the app to apply. Plus whether the bridge is set up. */
export async function readStepReports(url: URL, env: BridgeEnv): Promise<Response> {
  const configured = bridgeConfigured(env);
  if (url.searchParams.get("status")) return reply(200, { configured });
  if (!configured) return reply(200, { configured, reports: [], cursor: 0 });
  const db = env.LIVE!;
  await ensureSchema(db);
  const idem = url.searchParams.get("idem");
  if (idem !== null) return lookupStep(db, idem);
  const since = Math.max(0, Math.floor(Number(url.searchParams.get("since") ?? 0)) || 0);
  const rows = (await db.prepare("SELECT id, body FROM n8n_reports WHERE id > ? ORDER BY id LIMIT ?").bind(since, READ_LIMIT).all<{ id: number; body: string }>()).results;
  const reports: StepReportBody[] = [];
  for (const row of rows) {
    try {
      reports.push(JSON.parse(row.body) as StepReportBody);
    } catch {
      /* a broken row is skipped, never guessed */
    }
  }
  return reply(200, { configured, reports, cursor: rows.length ? rows[rows.length - 1].id : since });
}

/**
 * One step's record, for the app to settle an attempt it isn't sure about (after a restart, an
 * unclear answer or a timeout): whether the site ever sent it, and every report n8n posted for it.
 * No record means the site never sent it, because the record is written before the send.
 */
async function lookupStep(db: D1, idem: string): Promise<Response> {
  if (!/^[\w:-]{3,120}$/.test(idem)) return reply(400, { message: "Bad idempotency key." });
  const d = (await db.prepare("SELECT state, detail, created_at FROM n8n_dispatch WHERE idem = ?").bind(idem).all<{ state: string; detail: string | null; created_at: string }>()).results[0];
  const rows = (await db.prepare("SELECT body FROM n8n_reports WHERE idem = ? ORDER BY id").bind(idem).all<{ body: string }>()).results;
  const reports: StepReportBody[] = [];
  for (const row of rows) {
    try {
      reports.push(JSON.parse(row.body) as StepReportBody);
    } catch {
      /* skipped, never guessed */
    }
  }
  return reply(200, { configured: true, dispatch: d ? { state: d.state, createdAt: d.created_at, ...(d.detail ? { detail: d.detail } : {}) } : null, reports } satisfies StepLookup);
}

export interface StepLookup {
  configured: boolean;
  dispatch: { state: string; createdAt: string; detail?: string } | null;
  reports: StepReportBody[];
}

/** The Mac app's routes: same as the page's, with the sync key instead of Access. */
export async function forApp(req: Request, env: BridgeEnv, fetcher: Fetcher = fetch): Promise<Response> {
  if (!bearerOk(req, env.USAGE_SYNC_TOKEN)) return reply(401, { message: "The key doesn't match the site's sync key." });
  return req.method === "POST" ? dispatchStep(req, env, fetcher) : readStepReports(new URL(req.url), env);
}
