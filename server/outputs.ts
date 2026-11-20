// The Output Library's storage (src/library/model.ts has the shared rules). Metadata lives in the
// site's D1 database (the LIVE binding, `atlas-live`); file bytes live in a private R2 bucket bound
// as OUTPUTS. Nothing is public: the signed-in page reads through /api/outputs (Cloudflare Access),
// and producers add files through /api/hooks/outputs with the add-only AGENT_FEED_TOKEN, which
// can't list or read anything back.
//
// Each output keeps immutable versions. A version is written as "pending" before its bytes are
// stored, becomes "saved" only after storage accepted them, and is marked verified only after the
// stored file was read back and its SHA-256 matched. A version whose bytes couldn't be stored stays
// as "failed" with the reason, so the Library shows the missing deliverable instead of hiding it.
// Ingesting the same execution + artifact again never makes a second version: a saved one is
// answered as a duplicate, and a failed one is retried (up to MAX_STORAGE_ATTEMPTS in total).

import {
  formatOf,
  ingestProblem,
  MAX_FILE_BYTES,
  MAX_INGEST_BYTES,
  MAX_STORAGE_ATTEMPTS,
  PAGE_SIZE,
  PREVIEW_BYTES,
  previewKind,
  safeFilename,
  SEARCH_TEXT_CHARS,
  servedType,
  APPROVALS,
  FORMATS,
  STORAGE_STATES,
  validId,
  type Approval,
  type IngestArtifact,
  type IngestBody,
  type IngestSource,
  type ListPage,
  type OutputDetail,
  type OutputSummary,
  type OutputVersion,
  type StorageState,
} from "../src/library/model";
import { reportLine, validReport, type AgentReport } from "../src/reports/model";
import { bearerOk, type D1, type LiveEnv } from "./live";
import { reply } from "./http";

/** The parts of an R2 bucket binding the Library uses. */
export interface StoredObject {
  body: ReadableStream;
  size: number;
  arrayBuffer(): Promise<ArrayBuffer>;
}
export interface Bucket {
  put(key: string, value: Uint8Array, options?: { httpMetadata?: { contentType?: string }; customMetadata?: Record<string, string>; sha256?: string }): Promise<unknown>;
  get(key: string, options?: { range?: { offset: number; length: number } }): Promise<StoredObject | null>;
}

export interface OutputsEnv extends LiveEnv {
  /** R2 bucket binding for output files (private, never public). */
  OUTPUTS?: Bucket;
  /** "development" only on the local preview server (visual/library.preview.config.ts). */
  LIBRARY_ENV?: string;
}

export const OUTPUTS_HOOK = "/api/hooks/outputs";
/** Attempts within one ingest call before the version is left as failed for a later retry. */
export const ATTEMPTS_PER_CALL = 3;
const NOT_CONNECTED = "File storage isn't connected on the site yet (the OUTPUTS R2 bucket binding is missing). The record is kept; the file wasn't stored.";

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS library_outputs (
    id TEXT PRIMARY KEY, output_key TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, sample INTEGER NOT NULL DEFAULT 0)`,
  `CREATE TABLE IF NOT EXISTS library_versions (
    output_id TEXT NOT NULL, version INTEGER NOT NULL, ingest_key TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL, format TEXT NOT NULL, mime TEXT NOT NULL, size INTEGER NOT NULL, summary TEXT, search_text TEXT,
    agent TEXT NOT NULL, task_id TEXT, workflow TEXT, execution_id TEXT NOT NULL, run_url TEXT, project TEXT, building TEXT,
    via TEXT, source_url TEXT, storage_key TEXT NOT NULL, checksum TEXT,
    storage_state TEXT NOT NULL, storage_error TEXT, storage_attempts INTEGER NOT NULL DEFAULT 0, verified_at TEXT,
    approval TEXT NOT NULL, produced_at TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, sample INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (output_id, version))`,
  "CREATE INDEX IF NOT EXISTS library_versions_agent ON library_versions(agent)",
  "CREATE INDEX IF NOT EXISTS library_outputs_updated ON library_outputs(updated_at)",
];

const ready = new WeakSet<D1>();
export async function ensureLibrarySchema(db: D1) {
  if (ready.has(db)) return;
  await db.batch(SCHEMA.map((s) => db.prepare(s)));
  ready.add(db);
}

const enc = new TextEncoder();
async function sha256(data: Uint8Array): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function bytesOf(a: IngestArtifact): Uint8Array {
  if (typeof a.text === "string") return enc.encode(a.text);
  const bin = atob(a.base64!);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function searchTextOf(a: IngestArtifact, bytes: Uint8Array): string {
  const parts = [a.summary ?? ""];
  if (previewKind(a.mime) !== "none" && previewKind(a.mime) !== "image" && previewKind(a.mime) !== "pdf") parts.push(new TextDecoder().decode(bytes.subarray(0, SEARCH_TEXT_CHARS * 2)).slice(0, SEARCH_TEXT_CHARS));
  return parts.join("\n").slice(0, SEARCH_TEXT_CHARS);
}

/** The idempotency key: the producing agent, its execution and the artifact's identity in it. */
export const ingestKeyOf = (src: Pick<IngestSource, "agent" | "execution">, artifactId: string) => sha256(enc.encode(`${src.agent}\u0000${src.execution}\u0000${artifactId}`));
export const outputIdOf = async (outputKey: string) => `out_${(await sha256(enc.encode(outputKey))).slice(0, 20)}`;

interface Row {
  output_id: string;
  version: number;
  ingest_key: string;
  title: string;
  format: string;
  mime: string;
  size: number;
  summary: string | null;
  agent: string;
  task_id: string | null;
  workflow: string | null;
  execution_id: string;
  run_url: string | null;
  project: string | null;
  building: string | null;
  via: string | null;
  source_url: string | null;
  storage_key: string;
  checksum: string | null;
  storage_state: string;
  storage_error: string | null;
  storage_attempts: number;
  verified_at: string | null;
  approval: string;
  produced_at: string;
  created_at: string;
  sample: number;
}

const COLS = "v.output_id, v.version, v.ingest_key, v.title, v.format, v.mime, v.size, v.summary, v.agent, v.task_id, v.workflow, v.execution_id, v.run_url, v.project, v.building, v.via, v.source_url, v.storage_key, v.checksum, v.storage_state, v.storage_error, v.storage_attempts, v.verified_at, v.approval, v.produced_at, v.created_at, v.sample";

const pick = <T extends string>(all: readonly T[], v: string, fallback: T): T => ((all as readonly string[]).includes(v) ? (v as T) : fallback);

function toVersion(r: Row): OutputVersion {
  return {
    version: r.version,
    title: r.title,
    format: pick(FORMATS, r.format, "other"),
    mime: r.mime,
    size: r.size,
    summary: r.summary,
    agent: r.agent,
    task: r.task_id,
    workflow: r.workflow,
    execution: r.execution_id,
    runUrl: r.run_url,
    project: r.project,
    building: r.building,
    via: r.via,
    sourceUrl: r.source_url,
    checksum: r.checksum,
    storage: pick(STORAGE_STATES, r.storage_state, "failed"),
    storageError: r.storage_error,
    storageAttempts: r.storage_attempts,
    verifiedAt: r.verified_at,
    approval: pick(APPROVALS, r.approval, "awaiting"),
    producedAt: r.produced_at,
    createdAt: r.created_at,
    sample: !!r.sample,
  };
}

async function versionByKey(db: D1, ingestKey: string): Promise<Row | null> {
  const { results } = await db.prepare(`SELECT ${COLS} FROM library_versions v WHERE v.ingest_key = ?`).bind(ingestKey).all<Row>();
  return results[0] ?? null;
}

async function versionAt(db: D1, outputId: string, version: number): Promise<Row | null> {
  const { results } = await db.prepare(`SELECT ${COLS} FROM library_versions v WHERE v.output_id = ? AND v.version = ?`).bind(outputId, version).all<Row>();
  return results[0] ?? null;
}

export interface IngestResult {
  artifact: string;
  outputId?: string;
  version?: number;
  storage?: StorageState;
  verified?: boolean;
  duplicate?: boolean;
  message?: string;
}

export interface IngestOptions {
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  /** Marks records as development examples (the local preview server only). */
  sample?: boolean;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 300);

/**
 * Store a version's bytes, then read them back. Never marks a version saved unless storage
 * accepted the bytes, and never sets verified_at unless the read-back checksum matched.
 */
async function storeBytes(env: OutputsEnv, row: Row, bytes: Uint8Array, checksum: string, opts: IngestOptions): Promise<IngestResult> {
  const db = env.LIVE!;
  const now = opts.now ?? Date.now;
  const sleep = opts.sleep ?? defaultSleep;
  const base = { artifact: "", outputId: row.output_id, version: row.version };
  const update = (state: StorageState, error: string | null, attempts: number, verifiedAt: string | null) =>
    db
      .prepare("UPDATE library_versions SET storage_state = ?, storage_error = ?, storage_attempts = ?, verified_at = ?, checksum = ?, size = ?, updated_at = ? WHERE ingest_key = ? AND storage_state != 'saved'")
      .bind(state, error, attempts, verifiedAt, checksum, bytes.length, new Date(now()).toISOString(), row.ingest_key)
      .run();

  if (!env.OUTPUTS) {
    // Not an attempt: nothing was tried. The workflow can send the file again once storage is bound.
    await update("failed", NOT_CONNECTED, row.storage_attempts, null);
    return { ...base, storage: "failed", verified: false, message: NOT_CONNECTED };
  }
  let attempts = row.storage_attempts;
  if (attempts >= MAX_STORAGE_ATTEMPTS) return { ...base, storage: "failed", verified: false, message: `Storage was tried ${attempts} times; the retry limit is reached.` };

  let stored = false;
  let lastError = "";
  for (let i = 0; i < ATTEMPTS_PER_CALL && attempts < MAX_STORAGE_ATTEMPTS; i++) {
    attempts++;
    try {
      await env.OUTPUTS.put(row.storage_key, bytes, { httpMetadata: { contentType: row.mime }, customMetadata: { output: row.output_id, version: String(row.version) }, sha256: checksum });
      stored = true;
      break;
    } catch (e) {
      lastError = errText(e);
      if (i < ATTEMPTS_PER_CALL - 1 && attempts < MAX_STORAGE_ATTEMPTS) await sleep(250 * 3 ** i);
    }
  }
  if (!stored) {
    const message = `Couldn't store the file after ${attempts} attempt${attempts === 1 ? "" : "s"}: ${lastError}`;
    await update("failed", message, attempts, null);
    return { ...base, storage: "failed", verified: false, message };
  }

  // The read check: fetch what storage holds and compare checksums.
  try {
    const obj = await env.OUTPUTS.get(row.storage_key);
    const back = obj ? await sha256(new Uint8Array(await obj.arrayBuffer())) : null;
    if (back !== checksum) {
      const message = obj ? "Stored, but the read check returned different bytes." : "Stored, but the read check found no file.";
      await update("failed", message, attempts, null);
      return { ...base, storage: "failed", verified: false, message };
    }
    await update("saved", null, attempts, new Date(now()).toISOString());
    return { ...base, storage: "saved", verified: true };
  } catch (e) {
    const message = `Saved, but the read check couldn't run: ${errText(e)}`;
    await update("saved", message, attempts, null);
    return { ...base, storage: "saved", verified: false, message };
  }
}

async function ingestOne(env: OutputsEnv, src: IngestSource, a: IngestArtifact, opts: IngestOptions): Promise<IngestResult> {
  const db = env.LIVE!;
  const now = opts.now ?? Date.now;
  const bytes = bytesOf(a);
  if (bytes.length > MAX_FILE_BYTES) return { artifact: a.id, message: `File is larger than ${MAX_FILE_BYTES / 1024 / 1024} MB.` };
  const checksum = await sha256(bytes);
  const ingestKey = await ingestKeyOf(src, a.id);

  let row = await versionByKey(db, ingestKey);
  if (row?.storage_state === "saved") return { artifact: a.id, outputId: row.output_id, version: row.version, storage: "saved", verified: !!row.verified_at, duplicate: true };

  if (!row) {
    const outputKey = a.outputKey ?? `${src.agent}:${a.id}`;
    const outputId = await outputIdOf(outputKey);
    const at = new Date(now()).toISOString();
    const producedAt = src.producedAt ? new Date(src.producedAt).toISOString() : at;
    const approval: Approval = a.requiresApproval ? "awaiting" : "not_required";
    const storageKey = `outputs/${outputId}/${ingestKey.slice(0, 32)}`;
    await db.batch([
      db.prepare("INSERT INTO library_outputs (id, output_key, created_at, updated_at, sample) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET updated_at = excluded.updated_at").bind(outputId, outputKey, at, at, opts.sample ? 1 : 0),
      // The version number is taken inside the insert, so two runs landing at once can't share one.
      db
        .prepare(
          `INSERT OR IGNORE INTO library_versions (output_id, version, ingest_key, title, format, mime, size, summary, search_text, agent, task_id, workflow, execution_id, run_url, project, building, via, source_url, storage_key, checksum, storage_state, storage_attempts, approval, produced_at, created_at, updated_at, sample)
           SELECT ?, COALESCE((SELECT MAX(version) FROM library_versions WHERE output_id = ?), 0) + 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0, ?, ?, ?, ?, ?`,
        )
        .bind(
          outputId, outputId, ingestKey, a.title.trim(), formatOf(a.mime, a.kind ?? undefined), a.mime, bytes.length, a.summary?.trim() || null, searchTextOf(a, bytes),
          src.agent, src.task ?? null, src.workflow ?? null, src.execution, src.runUrl ?? null, src.project ?? null, src.building ?? null, src.via ?? null, a.sourceUrl ?? null,
          storageKey, checksum, approval, producedAt, at, at, opts.sample ? 1 : 0,
        ),
    ]);
    row = await versionByKey(db, ingestKey);
    if (!row) return { artifact: a.id, message: "The record couldn't be written." };
    if (row.storage_state === "saved") return { artifact: a.id, outputId: row.output_id, version: row.version, storage: "saved", verified: !!row.verified_at, duplicate: true };
  }
  return { ...(await storeBytes(env, row, bytes, checksum, opts)), artifact: a.id };
}

/** Ingest every artifact of one execution. Each file succeeds or fails on its own. */
export async function ingestOutputs(env: OutputsEnv, body: IngestBody, opts: IngestOptions = {}): Promise<IngestResult[]> {
  await ensureLibrarySchema(env.LIVE!);
  const out: IngestResult[] = [];
  for (const a of body.artifacts) {
    try {
      out.push(await ingestOne(env, body.source, a, opts));
    } catch (e) {
      out.push({ artifact: a.id, message: `Couldn't record this file: ${errText(e)}` });
    }
  }
  return out;
}

/** POST /api/hooks/outputs: a producer adds its files. Add-only; nothing can be read back here. */
export async function receiveOutputs(req: Request, env: OutputsEnv, opts: IngestOptions = {}): Promise<Response> {
  if (!env.LIVE || !env.AGENT_FEED_TOKEN) return reply(503, { message: "The Output Library isn't set up on the site yet (LIVE binding or AGENT_FEED_TOKEN missing)." });
  if (!bearerOk(req, env.AGENT_FEED_TOKEN)) return reply(401, { message: "The key doesn't match the site's AGENT_FEED_TOKEN." });
  if (Number(req.headers.get("content-length") ?? 0) > MAX_INGEST_BYTES) return reply(413, { message: "Payload too large." });
  const text = await req.text();
  if (text.length > MAX_INGEST_BYTES) return reply(413, { message: "Payload too large." });
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return reply(400, { message: "Body isn't JSON." });
  }
  const problem = ingestProblem(body);
  if (problem) return reply(400, { message: problem });
  const results = await ingestOutputs(env, body as IngestBody, opts);
  const missing = results.filter((r) => r.storage !== "saved").length;
  // 202 even when a file couldn't be stored: the workflow's own result stands, and the Library shows the gap.
  return reply(202, { results, missingFiles: missing });
}

// --- Agent reports: every stored report is archived as a JSON deliverable. ---

const REPORT_TITLE: Record<string, string> = { "github-opportunity-scout": "Opportunity Scout report", "benjaire-product-lab": "Product Lab report" };

export function reportArtifact(id: number, agent: string, at: string, body: AgentReport): IngestBody {
  return {
    source: { agent, execution: `report-${id}`, runUrl: ("run_url" in body && typeof body.run_url === "string" && body.run_url.startsWith("https://") ? body.run_url : null), producedAt: at, via: "agent_report" },
    artifacts: [{ id: "report.json", title: `${REPORT_TITLE[agent] ?? "Agent report"} · ${at.slice(0, 10)}`, mime: "application/json", kind: "report", text: JSON.stringify(body, null, 2), summary: reportLine(body), outputKey: `${agent}:report` }],
  };
}

/** Archive the newest stored report of an agent. Called after receiveReport stored it; never blocks it. */
export async function captureLatestReport(env: OutputsEnv, agent: string, opts: IngestOptions = {}): Promise<IngestResult[]> {
  const db = env.LIVE!;
  const { results } = await db.prepare("SELECT id, at, body FROM agent_reports WHERE agent = ? ORDER BY id DESC LIMIT 1").bind(agent).all<{ id: number; at: string; body: string }>();
  const r = results[0];
  if (!r) return [];
  const body = JSON.parse(r.body);
  if (!validReport(body)) return [];
  return ingestOutputs(env, reportArtifact(r.id, agent, r.at, body), opts);
}

/**
 * POST /api/outputs/reconcile: archive every report still held in D1 (the newest 20 per agent).
 * Idempotent; reports already pruned from D1 are gone and aren't claimed.
 */
export async function reconcileReports(env: OutputsEnv, opts: IngestOptions = {}): Promise<Response> {
  if (!env.LIVE) return reply(503, { message: "The site's database (LIVE binding) isn't connected." });
  const db = env.LIVE;
  await ensureLibrarySchema(db);
  let rows: { id: number; agent: string; at: string; body: string }[];
  try {
    rows = (await db.prepare("SELECT id, agent, at, body FROM agent_reports ORDER BY id").all<{ id: number; agent: string; at: string; body: string }>()).results;
  } catch {
    rows = []; // No reports table yet: nothing to reconcile.
  }
  const tally = { seen: rows.length, created: 0, duplicates: 0, missingFiles: 0, skipped: 0 };
  for (const r of rows) {
    const body = JSON.parse(r.body);
    if (!validReport(body)) {
      tally.skipped++;
      continue;
    }
    const [res] = await ingestOutputs(env, reportArtifact(r.id, r.agent, r.at, body), opts);
    if (res?.duplicate) tally.duplicates++;
    else tally.created++;
    if (res?.storage !== "saved") tally.missingFiles++;
  }
  return reply(200, tally);
}

/** POST /api/outputs/:id/versions/:v/retry: store a failed version again when Atlas still holds its source. */
export async function retryVersion(env: OutputsEnv, outputId: string, version: number, opts: IngestOptions = {}): Promise<Response> {
  if (!env.LIVE) return reply(503, { message: "The site's database (LIVE binding) isn't connected." });
  await ensureLibrarySchema(env.LIVE);
  const row = await versionAt(env.LIVE, outputId, version);
  if (!row) return reply(404, { message: "No such output version." });
  if (row.storage_state === "saved") return reply(200, { storage: "saved", verified: !!row.verified_at, message: "Already saved." });
  const m = /^report-(\d+)$/.exec(row.execution_id);
  if (row.via !== "agent_report" || !m) return reply(409, { message: "Atlas keeps no copy of a file it couldn't store. The workflow that made it has to send it again (same execution id), which retries this version without making a duplicate." });
  const { results } = await env.LIVE.prepare("SELECT id, agent, at, body FROM agent_reports WHERE id = ?").bind(Number(m[1])).all<{ id: number; agent: string; at: string; body: string }>();
  const r = results[0];
  const body = r ? JSON.parse(r.body) : null;
  if (!r || !validReport(body)) return reply(410, { message: "The report this came from is no longer held by the site, so the file can't be rebuilt." });
  const [res] = await ingestOutputs(env, reportArtifact(r.id, r.agent, r.at, body), opts);
  return reply(res?.storage === "saved" ? 200 : 502, res);
}

// --- Reading: the signed-in page only (Access protects every /api route except hooks). ---

const likeEscape = (s: string) => `%${s.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

export async function listOutputs(url: URL, env: OutputsEnv): Promise<Response> {
  const environment = env.LIBRARY_ENV === "development" ? "development" : "production";
  if (!env.LIVE) return reply(200, { configured: false, storageConnected: !!env.OUTPUTS, environment, total: 0, page: 1, pageSize: PAGE_SIZE, outputs: [], facets: { agents: [], projects: [] } } satisfies ListPage);
  const db = env.LIVE;
  await ensureLibrarySchema(db);
  const p = url.searchParams;
  const where: string[] = [environment === "development" ? "1 = 1" : "v.sample = 0"];
  const args: unknown[] = [];
  const q = (p.get("q") ?? "").trim().slice(0, 100);
  if (q) {
    where.push("(v.title LIKE ? ESCAPE '\\' OR v.agent LIKE ? ESCAPE '\\' OR v.task_id LIKE ? ESCAPE '\\' OR v.workflow LIKE ? ESCAPE '\\' OR v.execution_id LIKE ? ESCAPE '\\' OR v.search_text LIKE ? ESCAPE '\\')");
    args.push(...Array(6).fill(likeEscape(q)));
  }
  const format = p.get("format");
  if (format && (FORMATS as readonly string[]).includes(format)) {
    where.push("v.format = ?");
    args.push(format);
  }
  const agent = p.get("agent");
  if (agent && validId(agent)) {
    where.push("v.agent = ?");
    args.push(agent);
  }
  const approval = p.get("approval");
  if (approval && (APPROVALS as readonly string[]).includes(approval)) {
    where.push("v.approval = ?");
    args.push(approval);
  }
  const storage = p.get("storage");
  if (storage && (STORAGE_STATES as readonly string[]).includes(storage)) {
    where.push("v.storage_state = ?");
    args.push(storage);
  }
  const project = p.get("project");
  if (project && validId(project)) {
    // A project's outputs: recorded on the version, or made by one of the project's agents (from the catalog, sent by the page).
    const agents = (p.get("projectAgents") ?? "").split(",").filter(validId).slice(0, 200);
    where.push("(v.project = ? OR v.agent IN (SELECT value FROM json_each(?)))");
    args.push(project, JSON.stringify(agents));
  }
  const page = Math.max(1, Math.min(1000, Number(p.get("page")) || 1));
  const latest = "JOIN library_versions v ON v.output_id = o.id AND v.version = (SELECT MAX(version) FROM library_versions WHERE output_id = o.id)";
  const filter = where.join(" AND ");
  const [{ results: rows }, { results: count }, { results: agents }, { results: projects }] = await Promise.all([
    db
      .prepare(`SELECT o.output_key, o.updated_at AS o_updated, (SELECT COUNT(*) FROM library_versions c WHERE c.output_id = o.id) AS n, ${COLS} FROM library_outputs o ${latest} WHERE ${filter} ORDER BY o.updated_at DESC, o.id LIMIT ? OFFSET ?`)
      .bind(...args, PAGE_SIZE, (page - 1) * PAGE_SIZE)
      .all<Row & { output_key: string; o_updated: string; n: number }>(),
    db.prepare(`SELECT COUNT(*) AS total FROM library_outputs o ${latest} WHERE ${filter}`).bind(...args).all<{ total: number }>(),
    db.prepare(`SELECT DISTINCT agent FROM library_versions v WHERE ${where[0]} ORDER BY agent`).all<{ agent: string }>(),
    db.prepare(`SELECT DISTINCT project FROM library_versions v WHERE ${where[0]} AND project IS NOT NULL ORDER BY project`).all<{ project: string }>(),
  ]);
  const outputs: OutputSummary[] = rows.map((r) => ({ id: r.output_id, outputKey: r.output_key, latest: toVersion(r), versions: Number(r.n), updatedAt: r.o_updated }));
  return reply(200, {
    configured: true,
    storageConnected: !!env.OUTPUTS,
    environment,
    total: Number(count[0]?.total ?? 0),
    page,
    pageSize: PAGE_SIZE,
    outputs,
    facets: { agents: agents.map((a) => a.agent), projects: projects.map((x) => x.project) },
  } satisfies ListPage);
}

export async function outputDetail(env: OutputsEnv, outputId: string): Promise<Response> {
  if (!env.LIVE) return reply(503, { message: "The site's database (LIVE binding) isn't connected." });
  await ensureLibrarySchema(env.LIVE);
  const sampleOk = env.LIBRARY_ENV === "development";
  const { results: o } = await env.LIVE.prepare("SELECT id, output_key, updated_at, sample FROM library_outputs WHERE id = ?").bind(outputId).all<{ id: string; output_key: string; updated_at: string; sample: number }>();
  if (!o[0] || (o[0].sample && !sampleOk)) return reply(404, { message: "No such output." });
  const { results } = await env.LIVE.prepare(`SELECT ${COLS} FROM library_versions v WHERE v.output_id = ? ORDER BY v.version DESC`).bind(outputId).all<Row>();
  const history = results.map(toVersion);
  return reply(200, { id: o[0].id, outputKey: o[0].output_key, latest: history[0], versions: history.length, updatedAt: o[0].updated_at, history } satisfies OutputDetail);
}

/** Response headers that keep a served file inert: no sniffing, no scripts, no framing elsewhere. */
export function fileHeaders(row: Pick<Row, "mime" | "title" | "checksum" | "size">, download: boolean): Headers {
  const served = servedType(row.mime);
  const inline = served.inline && !download;
  const name = safeFilename(row.title, row.mime);
  const h = new Headers({
    "content-type": served.type,
    "content-disposition": `${inline ? "inline" : "attachment"}; filename="${name.replace(/[^\x20-\x7e]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(name)}`,
    "x-content-type-options": "nosniff",
    "cache-control": "private, no-store",
    "cross-origin-resource-policy": "same-origin",
    "referrer-policy": "no-referrer",
    // PDFs need the browser's viewer, which a sandboxed response blocks; everything else is sandboxed.
    "content-security-policy": served.type === "application/pdf" ? "default-src 'none'; frame-ancestors 'self'" : "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox; frame-ancestors 'self'",
  });
  if (row.checksum) h.set("x-atlas-sha256", row.checksum);
  return h;
}

/** GET /api/outputs/:id/versions/:v/file[?download=1|preview=1] */
export async function serveFile(url: URL, env: OutputsEnv, outputId: string, version: number): Promise<Response> {
  if (!env.LIVE) return reply(503, { message: "The site's database (LIVE binding) isn't connected." });
  await ensureLibrarySchema(env.LIVE);
  const row = await versionAt(env.LIVE, outputId, version);
  if (!row || (row.sample && env.LIBRARY_ENV !== "development")) return reply(404, { message: "No such output version." });
  if (row.storage_state !== "saved") return reply(409, { message: `This file wasn't saved${row.storage_error ? `: ${row.storage_error}` : "."}` });
  if (!env.OUTPUTS) return reply(503, { message: NOT_CONNECTED });
  const download = url.searchParams.get("download") === "1";
  const kind = previewKind(row.mime);
  // Text previews read only the start of the file; images and PDFs are drawn by the browser.
  const partial = url.searchParams.get("preview") === "1" && (kind === "text" || kind === "markdown" || kind === "table") && row.size > PREVIEW_BYTES;
  const obj = await env.OUTPUTS.get(row.storage_key, partial ? { range: { offset: 0, length: PREVIEW_BYTES } } : undefined);
  if (!obj) return reply(410, { message: "The stored file is missing from storage." });
  const headers = fileHeaders(row, download);
  if (partial) headers.set("x-atlas-truncated", String(row.size));
  else headers.set("content-length", String(obj.size));
  return new Response(obj.body, { status: 200, headers });
}

type Target = { kind: "list" } | { kind: "reconcile" } | { kind: "detail"; id: string } | { kind: "file" | "retry"; id: string; version: number } | { kind: "none" };

/** Which Library read or change a path names, after the route's prefix. */
function targetOf(parts: string[]): Target {
  if (parts.length === 0) return { kind: "list" };
  if (parts.length === 1 && parts[0] === "reconcile") return { kind: "reconcile" };
  const [id, versions, v, action] = parts;
  if (!id || !/^out_[0-9a-f]{20}$/.test(id)) return { kind: "none" };
  if (parts.length === 1) return { kind: "detail", id };
  const n = Number(v);
  if (parts.length !== 4 || versions !== "versions" || !Number.isInteger(n) || n < 1) return { kind: "none" };
  return action === "file" || action === "retry" ? { kind: action, id, version: n } : { kind: "none" };
}

const partsAfter = (url: URL, prefix: string) => url.pathname.slice(prefix.length).split("/").filter(Boolean);

/** Routes under /api/outputs for the signed-in page (functions/api/outputs/[[path]].ts). */
export async function routeOutputs(req: Request, env: OutputsEnv, opts: IngestOptions = {}): Promise<Response> {
  const url = new URL(req.url);
  const t = targetOf(partsAfter(url, "/api/outputs"));
  const get = req.method === "GET";
  if (t.kind === "none") return reply(404, { message: "Not found." });
  if (get && t.kind === "list") return listOutputs(url, env);
  if (get && t.kind === "detail") return outputDetail(env, t.id);
  if (get && t.kind === "file") return serveFile(url, env, t.id, t.version);
  if (req.method === "POST" && t.kind === "reconcile") return reconcileReports(env, opts);
  if (req.method === "POST" && t.kind === "retry") return retryVersion(env, t.id, t.version, opts);
  return reply(405, { message: "Not allowed." });
}

export const LIBRARY_APP_HOOK = "/api/hooks/library";

/**
 * /api/hooks/library[...]: the same Library reads for the Mac app, which has no Access session. It
 * sends the website sync key it already keeps in the Keychain (USAGE_SYNC_TOKEN). Read-only: list,
 * one output, and a version's file. Retry and reconcile stay on the signed-in web page.
 */
export async function routeOutputsForApp(req: Request, env: OutputsEnv): Promise<Response> {
  if (req.method.toUpperCase() !== "GET") return reply(405, { message: "Read-only." });
  if (!env.USAGE_SYNC_TOKEN) return reply(503, { message: "Website sync isn't set up on the site yet (USAGE_SYNC_TOKEN missing)." });
  if (!bearerOk(req, env.USAGE_SYNC_TOKEN)) return reply(401, { message: "The sync key doesn't match the site's USAGE_SYNC_TOKEN." });
  const url = new URL(req.url);
  const t = targetOf(partsAfter(url, LIBRARY_APP_HOOK));
  if (t.kind === "list") return listOutputs(url, env);
  if (t.kind === "detail") return outputDetail(env, t.id);
  if (t.kind === "file") return serveFile(url, env, t.id, t.version);
  return reply(404, { message: "Not found." });
}

