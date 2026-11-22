// The Atlas data API: the only way Atlas, n8n and agents read or write the PostgreSQL records.
//
//   /api/data/*        Khaneil, signed in through Cloudflare Access (checked by the middleware)
//   /api/hooks/data/*  n8n and agents, each with its own key from ATLAS_DATA_KEYS (checked here)
//   /api/hooks/data-overview  the Mac app, with its website sync key: GET overview only (read-only)
//
//   GET  status                       is the database set up and reachable (no secrets, no rows)
//   GET  overview                     recent runs, pending approvals, linked records (Khaneil only)
//   GET  context?project=|goal=|task=&q=&limit=   a limited set of related records for one job
//   GET  records/<table>/<id>         one record
//   POST records/<table>              create, or create-or-update by id (Idempotency-Key header)
//   POST runs                         record a run's start, progress or finish (idempotencyKey)
//   POST notes                        an AI-written summary or recommendation about a record
//   POST approvals                    ask Khaneil before something consequential
//   GET  approvals/<id>               has Khaneil decided (agents: only their own requests)
//   POST approvals/<id>/decision      approve or reject (Khaneil only)
//
// Agent memory (migration 0003, server/memory/service.ts; docs/agent-memory.md):
//   POST memory/prepare               before a job runs: create, update, skip, wait, resume, retry,
//                                     backoff or escalate, with the job's history and bounded memory
//   GET  memory/search?taskKey=&workflow=&project=&agent=&q=   prior runs and memory
//   POST memory                       working or operational memory (Idempotency-Key header)
//   POST memory/<id>/review           verify, dispute, revise or retire (Khaneil only)
//   GET  memory/agents/<agentId>      one agent's memory, runs and performance
//   POST feedback                     a run's checks against its success criteria, and a lesson
//   POST maintenance/sweep            mark stale runs timed out, expire working memory (Khaneil only)
//
// Every write runs in one transaction. Agents never change a record Khaneil created or confirmed:
// the change is filed as a pending "fact_change" approval and applied only when he approves it.
// Request bodies are never logged; log lines carry the route, caller id and outcome only.

import {
  checkFields,
  FACT_TABLES,
  FINAL_RUN_STATUSES,
  isFactTable,
  isUuid,
  KEY,
  parseApprovalRequest,
  parseDecision,
  parseNoteWrite,
  parseRecordWrite,
  parseRunWrite,
  referencesOf,
  TABLES,
  type DataOverview,
  type DataStatus,
  type FactTable,
  type Values,
} from "../../src/data/records";
import { reply } from "../http";
import { bearerOk } from "../live";
import { logEvent, type Sink } from "../log";
import { connectionStringOf, DbUnavailable, withDb, type Db, type DbEnv } from "./db";
import { agentMemory, memoryOverview, memoryReady, NOT_MIGRATED, prepare, reviewMemory, search, sweep, writeFeedback, writeMemory, type MemoryCtx } from "../memory/service";
import { agentFor, areasOf, canRead, canWrite, documentCategoriesOf, inArea, ownerActor, parseKeys, type Actor } from "./policy";

export interface DataEnv extends DbEnv {
  /** "key-id:key" pairs for agent callers; ids must be listed in server/data/policy.ts. */
  ATLAS_DATA_KEYS?: string;
  /** The website sync key the Mac app already holds (Settings → Website sync); reads the overview only. */
  USAGE_SYNC_TOKEN?: string;
}

export const MAX_BODY_BYTES = 64 * 1024;
export const CONTEXT_LIMIT = 10;
export const CONTEXT_MAX = 25;
const SERVICE = "atlas-data";

type Answer = { status: number; body: unknown };
const ok = (body: unknown, status = 200): Answer => ({ status, body });
const no = (status: number, message: string): Answer => ({ status, body: { message } });

/** An answer that must undo the transaction's writes (and isn't remembered for its idempotency key). */
class Refuse extends Error {
  constructor(readonly answer: Answer) {
    super(String((answer.body as { message?: string }).message));
  }
}
const refuse = (status: number, message: string): never => {
  throw new Refuse(no(status, message));
};

// ---- Entry points ---------------------------------------------------------------------------------

/** /api/data/*: the middleware has already checked Khaneil's Access session. */
export function forOwner(req: Request, env: DataEnv, path: string, deps: Deps = {}): Promise<Response> {
  return handle(req, env, ownerActor(req.headers.get("cf-access-authenticated-user-email")), path, deps);
}

/** /api/hooks/data/*: an agent key from ATLAS_DATA_KEYS, or nothing. */
export async function forAgent(req: Request, env: DataEnv, path: string, deps: Deps = {}): Promise<Response> {
  const actor = agentFor(req, env.ATLAS_DATA_KEYS);
  if (!actor) {
    log(deps, { event: "data.auth_denied", severity: "warn", status: 401, path });
    return reply(401, { message: "The key isn't one of the site's ATLAS_DATA_KEYS." });
  }
  return handle(req, env, actor, path, deps);
}

/**
 * /api/hooks/data-overview: the Task Center overview for the Mac app, which has no Access session.
 * It sends the website sync key it already keeps in the Keychain. Read-only: this entry point only
 * ever runs the overview route, so the app can see approvals but decides them on the web page.
 */
export async function forApp(req: Request, env: DataEnv, deps: Deps = {}): Promise<Response> {
  if (req.method.toUpperCase() !== "GET") return reply(405, { message: "Read-only." });
  if (!env.USAGE_SYNC_TOKEN) return reply(503, { message: "Website sync isn't set up on the site yet (USAGE_SYNC_TOKEN missing)." });
  if (!bearerOk(req, env.USAGE_SYNC_TOKEN)) {
    log(deps, { event: "data.auth_denied", severity: "warn", status: 401, path: "app/overview" });
    return reply(401, { message: "The sync key doesn't match the site's USAGE_SYNC_TOKEN." });
  }
  return handle(req, env, ownerActor("Atlas Mac app"), "overview", deps);
}

export interface Deps {
  /** Tests pass a database here; the site opens one per request from the environment. */
  db?: Db;
  sink?: Sink;
}

function log(deps: Deps, e: { event: string; severity: "info" | "warn" | "error"; [k: string]: unknown }) {
  logEvent({ service: SERVICE, ...e }, deps.sink);
}

async function handle(req: Request, env: DataEnv, actor: Actor, rawPath: string, deps: Deps): Promise<Response> {
  const path = rawPath.replace(/^\/+|\/+$/g, "");
  const parts = path.split("/");
  const method = req.method.toUpperCase();
  const route = routeOf(method, parts);
  if (!route) return reply(404, { message: "No such data route." });
  if (route.ownerOnly && actor.kind !== "owner") return reply(403, { message: "Only Khaneil can do this." });

  if (route.name === "status" && !deps.db) return reply(200, await statusOf(env));
  if (!deps.db && !connectionStringOf(env)) return reply(503, { message: "The Atlas database isn't set up on the site yet (ATLAS_DB Hyperdrive binding missing)." });

  let body: unknown = undefined;
  let bodyText = "";
  if (method === "POST") {
    if (Number(req.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) return reply(413, { message: "Payload too large." });
    bodyText = await req.text();
    if (bodyText.length > MAX_BODY_BYTES) return reply(413, { message: "Payload too large." });
    try {
      body = JSON.parse(bodyText);
    } catch {
      return reply(400, { message: "Body isn't JSON." });
    }
  }
  const idemKey = req.headers.get("idempotency-key")?.trim() || null;
  if (idemKey && !KEY.test(idemKey)) return reply(400, { message: "Idempotency-Key must be 8–128 letters, digits or . _ : -" });
  if (route.idempotent && actor.kind === "agent" && !idemKey) return reply(400, { message: "Agent writes need an Idempotency-Key header, so a retry can't write twice." });

  const url = new URL(req.url);
  const started = Date.now();
  try {
    const run = (db: Db) => route.run({ db, actor, parts, url, body, env });
    const answer = await (deps.db ? runIn(deps.db, run, route.idempotent ? { actor, key: idemKey, hashInput: `${method} ${path}\n${bodyText}` } : null) : withDb(env, (db) => runIn(db, run, route.idempotent ? { actor, key: idemKey, hashInput: `${method} ${path}\n${bodyText}` } : null)));
    log(deps, { event: `data.${route.name}`, severity: answer.status >= 400 ? "warn" : "info", status: answer.status, agentId: actor.kind === "agent" ? actor.id : undefined, table: route.table?.(parts), durationMs: Date.now() - started });
    return reply(answer.status, answer.body);
  } catch (e) {
    const answer = failure(e);
    log(deps, { event: `data.${route.name}`, severity: answer.status >= 500 ? "error" : "warn", status: answer.status, agentId: actor.kind === "agent" ? actor.id : undefined, durationMs: Date.now() - started, detail: answer.status >= 500 ? errorCode(e) : undefined });
    return reply(answer.status, answer.body);
  }
}

/** Runs one route in a transaction, answering a repeated idempotency key from its first answer. */
async function runIn(db: Db, run: (db: Db) => Promise<Answer>, idem: { actor: Actor; key: string | null; hashInput: string } | null): Promise<Answer> {
  try {
    return await db.tx(async (t) => {
      if (!idem?.key) return finish(await run(t));
      const hash = await sha256(idem.hashInput);
      const actorId = idem.actor.kind === "owner" ? "owner" : `agent:${idem.actor.id}`;
      // The insert is the claim: a second request with the same key waits here until the first
      // commits, then finds its row and gets the same answer.
      const claimed = await t.query("INSERT INTO atlas.idempotency_keys (actor, key, request_hash, status, response) VALUES ($1, $2, $3, 0, '{}'::jsonb) ON CONFLICT DO NOTHING RETURNING key", [actorId, idem.key, hash]);
      if (!claimed.length) {
        const [prior] = await t.query<{ request_hash: string; status: number; response: unknown }>("SELECT request_hash, status, response FROM atlas.idempotency_keys WHERE actor = $1 AND key = $2", [actorId, idem.key]);
        if (prior.request_hash !== hash) refuse(422, "This Idempotency-Key was already used for a different request.");
        return { status: prior.status, body: { ...(parse(prior.response) as object), replayed: true } };
      }
      const answer = finish(await run(t));
      await t.query("UPDATE atlas.idempotency_keys SET status = $3, response = $4::jsonb WHERE actor = $1 AND key = $2", [actorId, idem.key, answer.status, JSON.stringify(answer.body)]);
      return answer;
    });
  } catch (e) {
    if (e instanceof Refuse) return e.answer;
    throw e;
  }
}

/** A refusal undoes everything the route wrote; a success is kept. */
function finish(a: Answer): Answer {
  if (a.status >= 400) throw new Refuse(a);
  return a;
}

const parse = (v: unknown) => (typeof v === "string" ? JSON.parse(v) : v);

async function sha256(s: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const errorCode = (e: unknown) => (typeof e === "object" && e && "code" in e ? String((e as { code: unknown }).code) : e instanceof Error ? e.name : "unknown");

/** Database errors as plain answers, without echoing values back. */
function failure(e: unknown): Answer {
  if (e instanceof Refuse) return e.answer;
  if (e instanceof DbUnavailable) return no(503, e.message);
  switch (errorCode(e)) {
    case "23503":
      return no(422, "A linked record doesn't exist.");
    case "23514":
    case "22001":
      return no(422, "A value is outside what Atlas allows for that field.");
    case "22P02":
    case "22007":
    case "22008":
      return no(400, "A value has the wrong format.");
    case "23505": {
      // Two workers racing past the API's own checks meet the unique indexes from migration 0003.
      const constraint = typeof e === "object" && e ? String((e as { constraint_name?: string; constraint?: string }).constraint_name ?? (e as { constraint?: string }).constraint ?? "") : "";
      if (constraint === "agent_runs_one_live") return no(409, "Another run already holds this job. Don't start a second one.");
      if (constraint === "tasks_one_open_per_key") return no(409, "An open task already has this dedupe_key; nothing was filed.");
      return no(409, "That record already exists.");
    }
    case "40001":
    case "40P01":
      return no(503, "The database was busy. Try again.");
    case "57014":
      return no(503, "The database took too long. Try again.");
    case "42P01":
      return no(503, "The database tables aren't there yet. Run the migrations (docs/data-foundation.md).");
    case "ECONNREFUSED":
    case "CONNECT_TIMEOUT":
    case "ENOTFOUND":
      return no(503, "Atlas couldn't reach the database.");
    default:
      return no(500, "The data API hit an unexpected error.");
  }
}

// ---- Routing --------------------------------------------------------------------------------------

interface Ctx {
  db: Db;
  actor: Actor;
  parts: string[];
  url: URL;
  body: unknown;
  env: DataEnv;
}
interface Route {
  name: string;
  ownerOnly?: boolean;
  idempotent?: boolean;
  table?: (parts: string[]) => string | undefined;
  run: (c: Ctx) => Promise<Answer>;
}

function routeOf(method: string, p: string[]): Route | null {
  const [a, b, c, d] = p;
  if (method === "GET" && a === "status" && !b) return { name: "status", run: async ({ db, env }) => ok(await statusOf(env, db)) };
  if (method === "GET" && a === "overview" && !b) return { name: "overview", ownerOnly: true, run: overview };
  if (method === "GET" && a === "context" && !b) return { name: "context", run: context };
  if (a === "records" && b && isFactTable(b)) {
    if (method === "GET" && c && !d) return { name: "record.read", table: () => b, run: readRecord };
    if (method === "POST" && !c) return { name: "record.write", idempotent: true, table: () => b, run: writeRecord };
  }
  if (method === "POST" && a === "runs" && !b) return { name: "run.write", run: writeRun };
  if (method === "POST" && a === "notes" && !b) return { name: "note.write", idempotent: true, run: writeNote };
  const mem = (name: string, run: (c: MemoryCtx) => Promise<Answer>, extra: Partial<Route> = {}): Route => ({ name, ...extra, run: async (c) => ((await memoryReady(c.db)) ? run(c) : NOT_MIGRATED) });
  if (a === "memory") {
    if (method === "POST" && b === "prepare" && !c) return mem("memory.prepare", prepare);
    if (method === "GET" && b === "search" && !c) return mem("memory.search", search);
    if (method === "GET" && b === "agents" && c && !d) return mem("memory.agent", agentMemory);
    if (method === "POST" && !b) return mem("memory.write", writeMemory, { idempotent: true });
    if (method === "POST" && b && c === "review" && !d) return mem("memory.review", reviewMemory, { ownerOnly: true, idempotent: true });
  }
  if (method === "POST" && a === "feedback" && !b) return mem("feedback.write", writeFeedback, { idempotent: true });
  if (method === "POST" && a === "maintenance" && b === "sweep" && !c) return mem("maintenance.sweep", async ({ db, actor }) => ok({ result: "swept", ...(await sweep(db, actor.name)) }), { ownerOnly: true });
  if (a === "approvals") {
    if (method === "POST" && !b) return { name: "approval.request", idempotent: true, run: requestApproval };
    if (method === "GET" && b && !c) return { name: "approval.read", run: readApproval };
    if (method === "POST" && b && c === "decision" && !d) return { name: "approval.decide", ownerOnly: true, idempotent: true, run: decideApproval };
  }
  return null;
}

// ---- Status ---------------------------------------------------------------------------------------

export async function statusOf(env: DataEnv, db?: Db): Promise<DataStatus> {
  if (!db && !connectionStringOf(env)) return { state: "not-configured", need: "Bind the Hyperdrive config as ATLAS_DB on the Pages project (docs/data-foundation.md)." };
  const agentKeys = parseKeys(env.ATLAS_DATA_KEYS).length;
  const check = async (d: Db) => {
    const [row] = await d.query<{ v: number | null }>("SELECT max(version) AS v FROM atlas.schema_migrations");
    return { state: "ok" as const, schemaVersion: Number(row?.v ?? 0), agentKeys };
  };
  try {
    return db ? await check(db) : await withDb(env, check);
  } catch (e) {
    const a = failure(e);
    return { state: "error", message: (a.body as { message: string }).message };
  }
}

// ---- Reading --------------------------------------------------------------------------------------

/** Columns each table returns. Dates come back as YYYY-MM-DD text. */
const COLUMNS: Record<FactTable, string> = {
  goals: "id, title, description, area, priority, status, target_date::text AS target_date",
  projects: "id, title, description, area, status, goal_id",
  tasks: "id, title, description, area, status, priority, due_date::text AS due_date, project_id, goal_id, source",
  decisions: "id, decision, rationale, area, decided_on::text AS decided_on, project_id, goal_id",
  documents: "id, title, doc_type, storage_url, summary, doc_date::text AS doc_date, area, access_category, project_id, goal_id",
};
const META = "origin, created_by, updated_by, owner_confirmed_at, version, created_at, updated_at";
const selectOf = (t: FactTable) => `SELECT ${COLUMNS[t]}, ${META} FROM atlas.${t}`;

/** SQL that limits a table to what the caller may see, and its parameters. */
function visibility(actor: Actor, table: FactTable, params: unknown[]): string {
  const areas = areasOf(actor);
  if (!areas) return "TRUE";
  // Lists go in as comma-joined text: every value is a fixed name without commas, and it works
  // the same on every driver (postgres.js can't send arrays without fetching types first).
  params.push(areas.join(","));
  let sql = `area = ANY(string_to_array($${params.length}::text, ','))`;
  if (table === "documents") {
    params.push(documentCategoriesOf(actor)!.join(","));
    sql += ` AND access_category = ANY(string_to_array($${params.length}::text, ','))`;
  }
  return sql;
}

async function findVisible(db: Db, actor: Actor, table: FactTable, id: string, lock = false): Promise<Record<string, unknown> | null> {
  if (!canRead(actor, table)) return null;
  const params: unknown[] = [id];
  const where = visibility(actor, table, params);
  const [row] = await db.query(`${selectOf(table)} WHERE id = $1 AND ${where}${lock ? " FOR UPDATE" : ""}`, params);
  return row ?? null;
}

async function readRecord({ db, actor, parts }: Ctx): Promise<Answer> {
  const table = parts[1] as FactTable;
  if (!isUuid(parts[2])) return no(400, "The id must be a UUID.");
  if (!canRead(actor, table)) return no(403, `This key can't read ${table}.`);
  const row = await findVisible(db, actor, table, parts[2].toLowerCase());
  return row ? ok({ record: row }) : no(404, "No such record, or this key can't see it.");
}

/**
 * The context an agent needs for one job, kept small: the record itself, its goal and project,
 * open tasks, recent decisions, documents it may see, AI notes (marked as AI-written), recent runs,
 * and an optional plain search. Each list is capped.
 */
async function context({ db, actor, url }: Ctx): Promise<Answer> {
  const q = url.searchParams;
  const limit = Math.min(CONTEXT_MAX, Math.max(1, Number(q.get("limit")) || CONTEXT_LIMIT));
  const anchors = (["task", "project", "goal"] as const).filter((k) => q.get(k));
  const search = (q.get("q") ?? "").trim().slice(0, 100);
  if (anchors.length > 1) return no(400, "Ask for one of task, project or goal.");
  if (!anchors.length && !search) return no(400, "Ask for a task, project or goal id, or a search with q.");
  const out: Record<string, unknown> = { limit };

  let goalId: string | null = null;
  let projectId: string | null = null;
  if (anchors.length) {
    const kind = anchors[0];
    const id = q.get(kind)!;
    if (!isUuid(id)) return no(400, `${kind} must be a UUID.`);
    const table = `${kind}s` as FactTable;
    const anchor = await findVisible(db, actor, table, id.toLowerCase());
    if (!anchor) return no(404, `No such ${kind}, or this key can't see it.`);
    out[kind] = anchor;
    projectId = kind === "project" ? (anchor.id as string) : ((anchor.project_id as string | null) ?? null);
    goalId = kind === "goal" ? (anchor.id as string) : ((anchor.goal_id as string | null) ?? null);
    if (kind !== "project" && projectId) {
      const p = await findVisible(db, actor, "projects", projectId);
      out.project = p;
      goalId = goalId ?? ((p?.goal_id as string | null) ?? null);
    }
    if (kind !== "goal" && goalId) out.goal = await findVisible(db, actor, "goals", goalId);

    const linked = async (table: FactTable, extra: string, order: string) => {
      if (!canRead(actor, table)) return undefined;
      const params: unknown[] = [projectId, goalId];
      const where = visibility(actor, table, params);
      params.push(limit);
      return db.query(`${selectOf(table)} WHERE ((project_id = $1::uuid) OR ($1::uuid IS NULL AND goal_id = $2::uuid))${extra} AND ${where} ORDER BY ${order} LIMIT $${params.length}`, params);
    };
    out.tasks = await linked("tasks", " AND status NOT IN ('completed', 'cancelled')", "CASE priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END, due_date NULLS LAST, updated_at DESC");
    out.decisions = await linked("decisions", "", "decided_on DESC, created_at DESC");
    out.documents = await linked("documents", "", "doc_date DESC NULLS LAST, created_at DESC");
    if (kind === "goal" && canRead(actor, "projects")) {
      const params: unknown[] = [goalId];
      const where = visibility(actor, "projects", params);
      params.push(limit);
      out.projects = await db.query(`${selectOf("projects")} WHERE goal_id = $1 AND ${where} AND status IN ('planned', 'active', 'paused') ORDER BY updated_at DESC LIMIT $${params.length}`, params);
    }
    out.aiNotes = await db.query("SELECT id, kind, body, agent_id, model, created_at, true AS ai_generated FROM atlas.ai_notes WHERE subject_table = $1 AND subject_id = $2 ORDER BY created_at DESC LIMIT $3", [table, id.toLowerCase(), limit]);
    out.recentRuns = await db.query(
      `SELECT id, agent_id, status, result_summary, error, started_at, finished_at FROM atlas.agent_runs WHERE (${kind}_id = $1)${actor.kind === "agent" ? " AND agent_id = $3" : ""} ORDER BY started_at DESC LIMIT $2`,
      actor.kind === "agent" ? [id.toLowerCase(), Math.min(limit, 5), actor.id] : [id.toLowerCase(), Math.min(limit, 5)],
    );
  }

  if (search) {
    const pattern = `%${search.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
    const hits: unknown[] = [];
    for (const table of FACT_TABLES) {
      if (!canRead(actor, table)) continue;
      const params: unknown[] = [pattern];
      const where = visibility(actor, table, params);
      const label = TABLES[table].label;
      const text = table === "decisions" ? "coalesce(rationale, '')" : table === "documents" ? "coalesce(summary, '')" : "coalesce(description, '')";
      params.push(limit);
      const rows = await db.query(`SELECT id, '${table}' AS table, ${label} AS label, area, updated_at FROM atlas.${table} WHERE (${label} ILIKE $1 OR ${text} ILIKE $1) AND ${where} ORDER BY updated_at DESC LIMIT $${params.length}`, params);
      hits.push(...rows);
    }
    out.search = hits.slice(0, limit);
  }
  return ok(out);
}

// ---- Writing records ------------------------------------------------------------------------------

async function checkReferences(db: Db, actor: Actor, table: FactTable, values: Values) {
  for (const ref of referencesOf(table, values)) {
    const found = await findVisible(db, actor, ref.table, ref.id);
    if (!found) refuse(422, `The linked ${ref.table.replace(/s$/, "")} ${ref.id} doesn't exist, or this key can't see it.`);
  }
}

async function writeRecord(c: Ctx): Promise<Answer> {
  const { db, actor } = c;
  const table = c.parts[1] as FactTable;
  if (!canWrite(actor, table)) return no(403, `This key can't write ${table}.`);
  const parsed = parseRecordWrite(table, c.body);
  if (!parsed.ok) return no(400, parsed.error);
  const w = parsed.value;
  if (w.fields.area && !inArea(actor, w.fields.area)) return no(403, `This key can't write ${w.fields.area} records.`);
  if (table === "documents" && actor.kind === "agent" && w.fields.access_category && !documentCategoriesOf(actor)!.includes(w.fields.access_category)) return no(403, `This key can't file ${w.fields.access_category} documents.`);

  // The row may exist but be out of this key's sight; that answers the same as "not found" for a
  // read, but a create with that id would collide, so look without the area filter for the lock.
  const [existing] = w.id ? await db.query<Record<string, unknown>>(`${selectOf(table)} WHERE id = $1 FOR UPDATE`, [w.id]) : [];
  const by = actor.kind === "owner" ? "owner" : actor.id;

  if (w.fields.dedupe_key !== undefined && !(await memoryReady(db))) return NOT_MIGRATED;
  if (!existing) {
    const full = checkFields(table, w.fields, "create");
    if (!full.ok) return no(400, full.error);
    // Recurring work: an open task with the same dedupe key is answered, not filed again. (A worker
    // racing this one hits the unique index and gets 409.)
    if (table === "tasks" && full.value.dedupe_key) {
      const [open] = await db.query<{ id: string }>("SELECT id FROM atlas.tasks WHERE dedupe_key = $1 AND status IN ('queued', 'running', 'blocked', 'awaiting_approval') LIMIT 1", [full.value.dedupe_key]);
      if (open) {
        const record = await findVisible(db, actor, table, open.id);
        return ok({ result: "duplicate", record, message: "An open task already has this dedupe_key; nothing was filed." });
      }
    }
    const values = { ...full.value };
    if (table === "documents" && actor.kind === "agent" && !values.access_category) values.access_category = "internal";
    if (table === "tasks" && actor.kind === "agent" && !values.source) values.source = "agent";
    if (actor.kind === "agent" && !inArea(actor, values.area!)) return no(403, `This key can't write ${values.area} records.`);
    await checkReferences(db, actor, table, values);
    const cols = Object.keys(values);
    const params: unknown[] = cols.map((k) => values[k]);
    const extra = ["origin", "created_by", "updated_by", "owner_confirmed_at"];
    params.push(actor.kind === "owner" ? "owner" : "agent", by, by);
    const idCol = w.id ? ", id" : "";
    if (w.id) params.push(w.id);
    const placeholders = [...cols.map((_, i) => `$${i + 1}`), `$${cols.length + 1}`, `$${cols.length + 2}`, `$${cols.length + 3}`, actor.kind === "owner" ? "now()" : "NULL", ...(w.id ? [`$${cols.length + 4}`] : [])];
    const [row] = await db.query(`INSERT INTO atlas.${table} (${[...cols, ...extra].join(", ")}${idCol}) VALUES (${placeholders.join(", ")}) RETURNING id`, params);
    const record = await findVisible(db, actor, table, row.id as string);
    return ok({ result: "created", record }, 201);
  }

  // Updating. Rows outside the key's areas are reported as missing.
  if (actor.kind === "agent" && (!inArea(actor, existing.area as string) || (table === "documents" && !documentCategoriesOf(actor)!.includes(existing.access_category as string)))) return no(404, "No such record, or this key can't see it.");
  if (w.expectedVersion !== undefined && w.expectedVersion !== existing.version) return { status: 409, body: { message: `The record changed (now version ${existing.version}). Read it again before writing.`, version: existing.version } };
  await checkReferences(db, actor, table, w.fields);

  const ownedByOwner = existing.origin !== "agent" || existing.owner_confirmed_at !== null || existing.created_by !== by;
  if (actor.kind === "agent" && ownedByOwner) {
    // Never overwrite Khaneil's facts (or another agent's): ask instead.
    const area = (w.fields.area ?? existing.area) as string;
    const link = table === "goals" ? "goal_id" : table === "tasks" ? "task_id" : "project_id";
    const linkId = table === "goals" || table === "projects" || table === "tasks" ? existing.id : (existing.project_id ?? null);
    const [approval] = await db.query(
      `INSERT INTO atlas.approvals (kind, proposed_action, context, area, target_table, target_id, payload, requested_by, run_id, ${link})
       VALUES ('fact_change', $1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9) RETURNING id, status`,
      [
        `Change ${table.replace(/s$/, "")} "${String(existing[TABLES[table].label]).slice(0, 120)}": ${Object.keys(w.fields).join(", ")}`,
        `${actor.name} proposed this change to a record ${existing.origin === "agent" && existing.owner_confirmed_at === null ? "another agent created" : "you own"}. It is applied only if you approve it.`,
        area,
        table,
        existing.id,
        JSON.stringify({ fields: w.fields, baseVersion: existing.version }),
        by,
        w.runId ?? null,
        linkId,
      ],
    );
    return ok({ result: "approval_required", approval, message: "This record belongs to Khaneil, so the change waits for his approval." }, 202);
  }

  const record = await applyUpdate(db, actor, table, existing.id as string, w.fields, by);
  return ok({ result: "updated", record });
}

async function applyUpdate(db: Db, actor: Actor, table: FactTable, id: string, fields: Values, by: string) {
  const cols = Object.keys(fields);
  const params: unknown[] = cols.map((k) => fields[k]);
  params.push(by, id);
  const sets = [...cols.map((k, i) => `${k} = $${i + 1}`), `updated_by = $${cols.length + 1}`, ...(actor.kind === "owner" ? ["owner_confirmed_at = now()"] : [])];
  await db.query(`UPDATE atlas.${table} SET ${sets.join(", ")} WHERE id = $${cols.length + 2}`, params);
  return findVisible(db, actor, table, id);
}

// ---- Runs, notes, approvals -----------------------------------------------------------------------

const RUN_COLUMNS = "id, agent_id, workflow_id, external_run_id, idempotency_key, input_ref, status, result_summary, error, goal_id, project_id, task_id, model, input_tokens, output_tokens, cost_usd::text AS cost_usd, started_at, finished_at, version";

async function writeRun({ db, actor, body }: Ctx): Promise<Answer> {
  const parsed = parseRunWrite(body);
  if (!parsed.ok) return no(400, parsed.error);
  const r = parsed.value;
  if (actor.kind === "agent" && r.agentId !== actor.id) return no(403, `This key records runs for ${actor.id} only.`);
  for (const [table, id] of [["goals", r.goalId], ["projects", r.projectId], ["tasks", r.taskId]] as const) {
    if (id && !(await findVisible(db, actor, table, id))) return no(422, `The linked ${table.replace(/s$/, "")} doesn't exist, or this key can't see it.`);
  }
  const final = FINAL_RUN_STATUSES.includes(r.status);
  const v3 = await memoryReady(db);
  if (!v3 && (r.taskKey !== undefined || r.attempt !== undefined || r.leaseMinutes !== undefined)) return NOT_MIGRATED;
  const inserted = await db.query("INSERT INTO atlas.agent_runs (idempotency_key, agent_id, status) VALUES ($1, $2, $3) ON CONFLICT (idempotency_key) DO NOTHING RETURNING id", [r.idempotencyKey, r.agentId, r.status]);
  const [cur] = await db.query<{ id: string; agent_id: string; status: string }>("SELECT id, agent_id, status FROM atlas.agent_runs WHERE idempotency_key = $1 FOR UPDATE", [r.idempotencyKey]);
  if (cur.agent_id !== r.agentId) return no(409, "This idempotencyKey belongs to another agent's run.");
  if (!inserted.length && FINAL_RUN_STATUSES.includes(cur.status as never)) {
    if (cur.status === r.status) return ok({ result: "unchanged", run: (await db.query(`SELECT ${RUN_COLUMNS} FROM atlas.agent_runs WHERE id = $1`, [cur.id]))[0] });
    return no(409, `This run already finished as ${cur.status}.`);
  }
  const sets: string[] = ["status = $2"];
  const params: unknown[] = [cur.id, r.status];
  const set = (col: string, v: unknown) => {
    if (v === undefined) return;
    params.push(v);
    sets.push(`${col} = $${params.length}`);
  };
  set("workflow_id", r.workflowId);
  set("external_run_id", r.externalRunId);
  set("input_ref", r.inputRef);
  set("result_summary", r.resultSummary);
  set("error", r.error);
  set("goal_id", r.goalId);
  set("project_id", r.projectId);
  set("task_id", r.taskId);
  set("model", r.model);
  set("input_tokens", r.inputTokens);
  set("output_tokens", r.outputTokens);
  set("cost_usd", r.costUsd);
  if (v3) {
    if (r.taskKey !== undefined && r.taskKey !== null && !final) {
      // One live run per agent and job: a second worker is told who holds it, and its insert is undone.
      const [holder] = await db.query<{ id: string; external_run_id: string | null; attempt: number }>(
        "SELECT id, external_run_id, attempt FROM atlas.agent_runs WHERE agent_id = $1 AND task_key = $2 AND status IN ('queued', 'running') AND id <> $3 LIMIT 1",
        [r.agentId, r.taskKey, cur.id],
      );
      if (holder) return { status: 409, body: { message: `Another run already holds this job (${holder.external_run_id ? `#${holder.external_run_id}` : holder.id}, attempt ${holder.attempt}). Don't start a second one.`, holder: holder.id } };
    }
    set("task_key", r.taskKey);
    set("attempt", r.attempt);
    if (!final) sets.push("heartbeat_at = now()");
    if (r.leaseMinutes !== undefined && !final) {
      params.push(r.leaseMinutes);
      sets.push(`lease_until = now() + make_interval(mins => $${params.length}::int)`);
    }
    if (final) sets.push("lease_until = NULL");
  }
  if (final) sets.push("finished_at = now()");
  const [run] = await db.query(`UPDATE atlas.agent_runs SET ${sets.join(", ")} WHERE id = $1 RETURNING ${RUN_COLUMNS}${v3 ? ", task_key, attempt, heartbeat_at, lease_until" : ""}`, params);
  return ok({ result: inserted.length ? "recorded" : "updated", run }, inserted.length ? 201 : 200);
}

async function writeNote({ db, actor, body }: Ctx): Promise<Answer> {
  const parsed = parseNoteWrite(body);
  if (!parsed.ok) return no(400, parsed.error);
  const n = parsed.value;
  const subject = await findVisible(db, actor, n.subjectTable, n.subjectId);
  if (!subject) return no(404, "No such record, or this key can't see it.");
  const [note] = await db.query("INSERT INTO atlas.ai_notes (subject_table, subject_id, kind, body, area, agent_id, model, run_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id, kind, created_at", [
    n.subjectTable,
    n.subjectId,
    n.kind,
    n.body,
    subject.area,
    actor.kind === "owner" ? "owner" : actor.id,
    n.model ?? null,
    n.runId ?? null,
  ]);
  return ok({ result: "created", note }, 201);
}

const APPROVAL_COLUMNS = "id, kind, proposed_action, context, area, status, requested_by, target_table, target_id, payload, run_id, task_id, project_id, goal_id, reviewer, decision_note, decided_at, expires_at, created_at, version";

async function expireOld(db: Db) {
  await db.query("UPDATE atlas.approvals SET status = 'expired', decided_at = now() WHERE status = 'pending' AND expires_at IS NOT NULL AND expires_at < now()");
}

async function requestApproval({ db, actor, body }: Ctx): Promise<Answer> {
  const parsed = parseApprovalRequest(body);
  if (!parsed.ok) return no(400, parsed.error);
  const a = parsed.value;
  if (!inArea(actor, a.area)) return no(403, `This key can't ask about ${a.area}.`);
  for (const [table, id] of [["goals", a.goalId], ["projects", a.projectId], ["tasks", a.taskId]] as const) {
    if (id && !(await findVisible(db, actor, table, id))) return no(422, `The linked ${table.replace(/s$/, "")} doesn't exist, or this key can't see it.`);
  }
  const [approval] = await db.query(
    `INSERT INTO atlas.approvals (kind, proposed_action, context, area, requested_by, run_id, task_id, project_id, goal_id, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, CASE WHEN $10::int IS NULL THEN NULL ELSE now() + make_interval(hours => $10::int) END) RETURNING ${APPROVAL_COLUMNS}`,
    [a.kind, a.proposedAction, a.context ?? null, a.area, actor.kind === "owner" ? "owner" : actor.id, a.runId ?? null, a.taskId ?? null, a.projectId ?? null, a.goalId ?? null, a.expiresInHours ?? null],
  );
  return ok({ result: "pending", approval }, 201);
}

async function readApproval({ db, actor, parts }: Ctx): Promise<Answer> {
  if (!isUuid(parts[1])) return no(400, "The id must be a UUID.");
  await expireOld(db);
  const [row] = await db.query(`SELECT ${APPROVAL_COLUMNS} FROM atlas.approvals WHERE id = $1${actor.kind === "agent" ? " AND requested_by = $2" : ""}`, actor.kind === "agent" ? [parts[1].toLowerCase(), actor.id] : [parts[1].toLowerCase()]);
  return row ? ok({ approval: row }) : no(404, "No such approval, or this key didn't ask for it.");
}

async function decideApproval({ db, actor, parts, body }: Ctx): Promise<Answer> {
  if (!isUuid(parts[1])) return no(400, "The id must be a UUID.");
  const parsed = parseDecision(body);
  if (!parsed.ok) return no(400, parsed.error);
  await expireOld(db);
  const [a] = await db.query<{ id: string; kind: string; status: string; target_table: string | null; target_id: string | null; payload: unknown }>(`SELECT ${APPROVAL_COLUMNS} FROM atlas.approvals WHERE id = $1 FOR UPDATE`, [parts[1].toLowerCase()]);
  if (!a) return no(404, "No such approval.");
  if (a.status !== "pending") return no(409, `This approval is already ${a.status}.`);
  let record: unknown = undefined;
  if (parsed.value.decision === "approve" && a.kind === "fact_change") {
    const table = a.target_table as FactTable;
    const payload = parse(a.payload) as { fields: Values; baseVersion: number };
    const checked = checkFields(table, payload.fields, "update");
    if (!checked.ok) return no(422, `The proposed change is no longer valid: ${checked.error}`);
    const [target] = await db.query<{ id: string; version: number }>(`SELECT id, version FROM atlas.${table} WHERE id = $1 FOR UPDATE`, [a.target_id]);
    if (!target) return no(409, "The record this change was for no longer exists. Reject it.");
    if (target.version !== payload.baseVersion) return no(409, "The record changed after this was proposed. Reject it and let the agent propose again.");
    await checkReferences(db, actor, table, checked.value);
    record = await applyUpdate(db, actor, table, target.id, checked.value, "owner");
  }
  const [approval] = await db.query(`UPDATE atlas.approvals SET status = $2, reviewer = $3, decision_note = $4, decided_at = now() WHERE id = $1 RETURNING ${APPROVAL_COLUMNS}`, [
    a.id,
    parsed.value.decision === "approve" ? "approved" : "rejected",
    actor.name,
    parsed.value.note,
  ]);
  return ok({ result: approval.status, approval, ...(record ? { record } : {}) });
}

// ---- Overview (the Task Center card) --------------------------------------------------------------

async function overview({ db, env, actor }: Ctx): Promise<Answer> {
  await expireOld(db);
  const status = await statusOf(env, db);
  if (status.state !== "ok") return no(503, status.state === "error" ? status.message : status.need);
  const v3 = await memoryReady(db);
  if (v3) await sweep(db, actor.name);
  const runs = await db.query(
    `SELECT id, agent_id, workflow_id, external_run_id, status, result_summary, error, goal_id, project_id, task_id, cost_usd::text AS cost_usd, started_at, finished_at${v3 ? ", task_key, attempt" : ""} FROM atlas.agent_runs ORDER BY started_at DESC LIMIT 15`,
  );
  const approvals = await db.query(`SELECT ${APPROVAL_COLUMNS} FROM atlas.approvals WHERE status = 'pending' ORDER BY created_at DESC LIMIT 20`);
  const records = await db.query(
    `(SELECT id, 'goals' AS "table", title AS label, status, area, updated_at FROM atlas.goals WHERE status IN ('proposed', 'active', 'paused') ORDER BY updated_at DESC LIMIT 10)
     UNION ALL (SELECT id, 'projects', title, status, area, updated_at FROM atlas.projects WHERE status IN ('planned', 'active', 'paused') ORDER BY updated_at DESC LIMIT 15)
     UNION ALL (SELECT id, 'tasks', title, status, area, updated_at FROM atlas.tasks ORDER BY updated_at DESC LIMIT 10)`,
  );
  const [counts] = await db.query<Record<string, string | number>>(
    `SELECT (SELECT count(*) FROM atlas.agent_runs WHERE started_at > now() - interval '24 hours') AS runs24h,
            (SELECT count(*) FROM atlas.agent_runs WHERE status = 'failed' AND started_at > now() - interval '24 hours') AS failed24h,
            (SELECT count(*) FROM atlas.approvals WHERE status = 'pending') AS pending,
            (SELECT count(*) FROM atlas.tasks WHERE status NOT IN ('completed', 'cancelled')) AS open`,
  );
  const answer: DataOverview = {
    status,
    runs: runs as never,
    approvals: (approvals as { payload: unknown }[]).map((a) => ({ ...a, payload: a.payload == null ? null : parse(a.payload) })) as never,
    records: records as never,
    counts: { runs24h: Number(counts.runs24h), runsFailed24h: Number(counts.failed24h), approvalsPending: Number(counts.pending), tasksOpen: Number(counts.open) },
    memory: v3 ? await memoryOverview(db) : null,
  };
  return ok(answer);
}

