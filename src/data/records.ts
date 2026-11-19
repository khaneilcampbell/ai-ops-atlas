// The Atlas records kept in PostgreSQL (db/migrations/0001_atlas_core.sql): what each one holds,
// which values are allowed, and the checks every write passes before it reaches the database.
// Shared by the data API (server/data/) and the Task Center's database card, so the page and the
// server agree on names and statuses. Model output is untrusted: everything an agent sends is
// checked here for required fields, allowed values, lengths and ids, and unknown fields are refused.

import { TASK_PRIORITIES, TASK_SOURCES, TASK_STATUSES } from "../tasks/types";

export const AREAS = ["business", "projects", "career", "life", "finance"] as const;
export type Area = (typeof AREAS)[number];
export const AREA_LABEL: Record<Area, string> = { business: "Business", projects: "Projects", career: "Career", life: "Life", finance: "Finance" };

export const GOAL_STATUSES = ["proposed", "active", "paused", "achieved", "dropped"] as const;
export const PROJECT_STATUSES = ["planned", "active", "paused", "done", "dropped"] as const;
export const DOC_TYPES = ["note", "report", "contract", "resume", "plan", "spec", "invoice", "other"] as const;
/** Who may see a document. Agent keys never see "restricted", whatever their policy says. */
export const ACCESS_CATEGORIES = ["shared", "internal", "private", "restricted"] as const;
export type AccessCategory = (typeof ACCESS_CATEGORIES)[number];
export const RUN_STATUSES = ["queued", "running", "succeeded", "failed", "cancelled"] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];
export const FINAL_RUN_STATUSES: readonly RunStatus[] = ["succeeded", "failed", "cancelled"];
export const APPROVAL_STATUSES = ["pending", "approved", "rejected", "cancelled", "expired"] as const;
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];
/** What needs Khaneil's yes. fact_change is filed by the API itself when an agent tries to change an owner fact. */
export const APPROVAL_KINDS = ["external_message", "financial", "destructive", "external_write", "fact_change", "other"] as const;
export type ApprovalKind = (typeof APPROVAL_KINDS)[number];
export const APPROVAL_KIND_LABEL: Record<ApprovalKind, string> = {
  external_message: "Message outside Atlas",
  financial: "Money",
  destructive: "Destructive change",
  external_write: "Change in another system",
  fact_change: "Change to your record",
  other: "Other",
};
export const NOTE_KINDS = ["summary", "recommendation", "extraction", "risk"] as const;

/** The fact tables a write may name. Agent runs, approvals and notes have their own routes. */
export const FACT_TABLES = ["goals", "projects", "tasks", "decisions", "documents"] as const;
export type FactTable = (typeof FACT_TABLES)[number];
export const isFactTable = (t: string): t is FactTable => (FACT_TABLES as readonly string[]).includes(t);

type Field =
  | { kind: "text"; max: number; min?: number }
  | { kind: "enum"; values: readonly string[] }
  | { kind: "date" }
  | { kind: "uuid"; ref?: FactTable }
  | { kind: "url"; max: number };

interface TableSpec {
  /** Column → check. Only these columns can be written. */
  fields: Record<string, Field>;
  /** Needed to create a row. */
  required: readonly string[];
  /** The column the row's short name comes from, for lists and links. */
  label: string;
}

const T = (max: number, min = 0): Field => ({ kind: "text", max, min });
const E = (values: readonly string[]): Field => ({ kind: "enum", values });
const area = E(AREAS);
const goalRef: Field = { kind: "uuid", ref: "goals" };
const projectRef: Field = { kind: "uuid", ref: "projects" };

export const TABLES: Record<FactTable, TableSpec> = {
  goals: { label: "title", required: ["title", "area"], fields: { title: T(200, 1), description: T(4000), area, priority: E(TASK_PRIORITIES), status: E(GOAL_STATUSES), target_date: { kind: "date" } } },
  projects: { label: "title", required: ["title", "area"], fields: { title: T(200, 1), description: T(4000), area, status: E(PROJECT_STATUSES), goal_id: goalRef } },
  tasks: {
    label: "title",
    required: ["title", "area"],
    fields: { title: T(200, 1), description: T(4000), area, status: E(TASK_STATUSES), priority: E(TASK_PRIORITIES), due_date: { kind: "date" }, project_id: projectRef, goal_id: goalRef, source: E(TASK_SOURCES) },
  },
  decisions: { label: "decision", required: ["decision", "area"], fields: { decision: T(500, 1), rationale: T(4000), area, decided_on: { kind: "date" }, project_id: projectRef, goal_id: goalRef } },
  documents: {
    label: "title",
    required: ["title", "doc_type", "area"],
    fields: { title: T(200, 1), doc_type: E(DOC_TYPES), storage_url: { kind: "url", max: 2000 }, summary: T(4000), doc_date: { kind: "date" }, area, access_category: E(ACCESS_CATEGORIES), project_id: projectRef, goal_id: goalRef },
  },
};

export type Values = Record<string, string | null>;
export type Checked<V> = { ok: true; value: V } | { ok: false; error: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === "string" && UUID.test(v);
const DATE = /^\d{4}-\d{2}-\d{2}$/;
export const isDate = (v: unknown): v is string => typeof v === "string" && DATE.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().startsWith(v);
/** Idempotency keys and other caller-made ids: 8–128 plain characters. */
export const KEY = /^[A-Za-z0-9._:-]{8,128}$/;
export const AGENT_ID = /^[a-z0-9][a-z0-9-]{0,79}$/;
// Control characters other than tab and newline are refused: they have no place in a record and
// are a common sign of garbled model output.
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function checkField(name: string, f: Field, v: unknown): Checked<string | null> {
  if (v === null) return { ok: true, value: null };
  switch (f.kind) {
    case "text": {
      if (typeof v !== "string") return { ok: false, error: `${name} must be text.` };
      const s = v.trim();
      if (CONTROL.test(s)) return { ok: false, error: `${name} has control characters.` };
      if (s.length < (f.min ?? 0)) return { ok: false, error: `${name} can't be empty.` };
      if (s.length > f.max) return { ok: false, error: `${name} is longer than ${f.max} characters.` };
      return { ok: true, value: s.length ? s : null };
    }
    case "enum":
      return typeof v === "string" && f.values.includes(v) ? { ok: true, value: v } : { ok: false, error: `${name} must be one of: ${f.values.join(", ")}.` };
    case "date":
      return isDate(v) ? { ok: true, value: v } : { ok: false, error: `${name} must be a date like 2026-12-31.` };
    case "uuid":
      return isUuid(v) ? { ok: true, value: v.toLowerCase() } : { ok: false, error: `${name} must be a UUID.` };
    case "url":
      if (typeof v !== "string" || v.length > f.max || CONTROL.test(v)) return { ok: false, error: `${name} must be an https link up to ${f.max} characters.` };
      try {
        const u = new URL(v);
        if (u.protocol !== "https:" || u.username || u.password) return { ok: false, error: `${name} must be an https link without a user name or password.` };
      } catch {
        return { ok: false, error: `${name} isn't a valid link.` };
      }
      return { ok: true, value: v };
  }
}

/**
 * Checks the fields of a create or update. A create needs the table's required fields; an update
 * may send any subset. Unknown fields (id, origin, version, timestamps…) are refused, not dropped,
 * so a caller learns it sent something Atlas ignores.
 */
export function checkFields(table: FactTable, input: unknown, mode: "create" | "update"): Checked<Values> {
  if (!isObject(input)) return { ok: false, error: "fields must be an object." };
  const spec = TABLES[table];
  const out: Values = {};
  for (const [k, v] of Object.entries(input)) {
    const f = spec.fields[k];
    if (!f) return { ok: false, error: `${table} has no field "${k.slice(0, 60)}" that can be written.` };
    const c = checkField(k, f, v);
    if (!c.ok) return c;
    out[k] = c.value;
  }
  if (mode === "create") for (const r of spec.required) if (out[r] == null) return { ok: false, error: `${r} is required to create ${table === "tasks" ? "a task" : `a ${table.replace(/s$/, "")}`}.` };
  if (mode === "update" && Object.keys(out).length === 0) return { ok: false, error: "Nothing to change." };
  if (mode === "update") for (const r of spec.required) if (r in out && out[r] == null) return { ok: false, error: `${r} can't be cleared.` };
  return { ok: true, value: out };
}

/** The ids a write points at, by the table each must exist in. */
export function referencesOf(table: FactTable, values: Values): { table: FactTable; id: string }[] {
  const out: { table: FactTable; id: string }[] = [];
  for (const [k, f] of Object.entries(TABLES[table].fields)) if (f.kind === "uuid" && f.ref && values[k]) out.push({ table: f.ref, id: values[k]! });
  return out;
}

// ---- Write requests -----------------------------------------------------------------------------

export interface RecordWrite {
  /** Omit to create with a new id. Send a UUID you made to create-or-update that row (safe to retry). */
  id?: string;
  fields: Values;
  /** Refuse the update unless the row is still at this version (optimistic locking). */
  expectedVersion?: number;
  /** The agent run this write belongs to, for the record of who changed what. */
  runId?: string;
}

export function parseRecordWrite(table: FactTable, body: unknown): Checked<RecordWrite & { mode: "create" | "upsert" }> {
  if (!isObject(body)) return { ok: false, error: "The body must be a JSON object." };
  const extra = Object.keys(body).find((k) => !["id", "fields", "expectedVersion", "runId"].includes(k));
  if (extra) return { ok: false, error: `Unknown property "${extra.slice(0, 60)}". Use id, fields, expectedVersion and runId.` };
  if (body.id !== undefined && !isUuid(body.id)) return { ok: false, error: "id must be a UUID." };
  if (body.runId !== undefined && !isUuid(body.runId)) return { ok: false, error: "runId must be a UUID." };
  if (body.expectedVersion !== undefined && !(Number.isInteger(body.expectedVersion) && (body.expectedVersion as number) >= 1)) return { ok: false, error: "expectedVersion must be a whole number from 1." };
  // An update is only checked as one once the row is known to exist, so check both shapes here
  // and let the API pick. A create must carry the required fields.
  const asUpdate = checkFields(table, body.fields, "update");
  if (!asUpdate.ok) return asUpdate;
  return { ok: true, value: { id: (body.id as string | undefined)?.toLowerCase(), fields: asUpdate.value, expectedVersion: body.expectedVersion as number | undefined, runId: body.runId as string | undefined, mode: body.id ? "upsert" : "create" } };
}

export interface RunWrite {
  idempotencyKey: string;
  agentId: string;
  status: RunStatus;
  workflowId?: string | null;
  externalRunId?: string | null;
  inputRef?: string | null;
  resultSummary?: string | null;
  error?: string | null;
  goalId?: string | null;
  projectId?: string | null;
  taskId?: string | null;
  model?: string | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  costUsd?: number | null;
}

const RUN_KEYS = ["idempotencyKey", "agentId", "status", "workflowId", "externalRunId", "inputRef", "resultSummary", "error", "goalId", "projectId", "taskId", "model", "inputTokens", "outputTokens", "costUsd"];

function optText(body: Record<string, unknown>, k: string, max: number): Checked<string | null | undefined> {
  const v = body[k];
  if (v === undefined || v === null) return { ok: true, value: v as null | undefined };
  if (typeof v !== "string" || CONTROL.test(v)) return { ok: false, error: `${k} must be plain text.` };
  const s = v.trim();
  // Long errors and summaries are cut, not refused: a failure report must still be recorded.
  return { ok: true, value: s.length > max ? `${s.slice(0, max - 1)}…` : s || null };
}

/** A run's start, progress or finish. The same idempotencyKey always means the same run. */
export function parseRunWrite(body: unknown): Checked<RunWrite> {
  if (!isObject(body)) return { ok: false, error: "The body must be a JSON object." };
  const extra = Object.keys(body).find((k) => !RUN_KEYS.includes(k));
  if (extra) return { ok: false, error: `Unknown property "${extra.slice(0, 60)}".` };
  if (typeof body.idempotencyKey !== "string" || !KEY.test(body.idempotencyKey)) return { ok: false, error: "idempotencyKey must be 8–128 letters, digits or . _ : -" };
  if (typeof body.agentId !== "string" || !AGENT_ID.test(body.agentId)) return { ok: false, error: "agentId must be lower-case letters, digits and dashes." };
  if (typeof body.status !== "string" || !(RUN_STATUSES as readonly string[]).includes(body.status)) return { ok: false, error: `status must be one of: ${RUN_STATUSES.join(", ")}.` };
  const out: RunWrite = { idempotencyKey: body.idempotencyKey, agentId: body.agentId, status: body.status as RunStatus };
  for (const [k, max] of [["workflowId", 120], ["externalRunId", 120], ["inputRef", 500], ["resultSummary", 2000], ["error", 2000], ["model", 120]] as const) {
    const c = optText(body, k, max);
    if (!c.ok) return c;
    if (c.value !== undefined) out[k] = c.value;
  }
  for (const k of ["goalId", "projectId", "taskId"] as const) {
    if (body[k] === undefined) continue;
    if (body[k] !== null && !isUuid(body[k])) return { ok: false, error: `${k} must be a UUID.` };
    out[k] = body[k] === null ? null : (body[k] as string).toLowerCase();
  }
  for (const k of ["inputTokens", "outputTokens"] as const) {
    if (body[k] === undefined) continue;
    if (body[k] !== null && !(Number.isInteger(body[k]) && (body[k] as number) >= 0 && (body[k] as number) < 2 ** 31)) return { ok: false, error: `${k} must be a whole number from 0.` };
    out[k] = body[k] as number | null;
  }
  if (body.costUsd !== undefined) {
    if (body.costUsd !== null && !(typeof body.costUsd === "number" && Number.isFinite(body.costUsd) && body.costUsd >= 0 && body.costUsd < 1_000_000)) return { ok: false, error: "costUsd must be a number from 0." };
    out.costUsd = body.costUsd as number | null;
  }
  if (out.status === "failed" && !out.error) return { ok: false, error: "A failed run needs an error." };
  return { ok: true, value: out };
}

export interface ApprovalRequest {
  kind: Exclude<ApprovalKind, "fact_change">;
  proposedAction: string;
  context?: string | null;
  area: Area;
  runId?: string | null;
  taskId?: string | null;
  projectId?: string | null;
  goalId?: string | null;
  /** Ask again after this many hours; the approval is shown as expired after that. */
  expiresInHours?: number;
}

/** An agent asking Khaneil before doing something consequential. fact_change is never asked for directly. */
export function parseApprovalRequest(body: unknown): Checked<ApprovalRequest> {
  if (!isObject(body)) return { ok: false, error: "The body must be a JSON object." };
  const extra = Object.keys(body).find((k) => !["kind", "proposedAction", "context", "area", "runId", "taskId", "projectId", "goalId", "expiresInHours"].includes(k));
  if (extra) return { ok: false, error: `Unknown property "${extra.slice(0, 60)}".` };
  if (typeof body.kind !== "string" || !(APPROVAL_KINDS as readonly string[]).includes(body.kind) || body.kind === "fact_change") return { ok: false, error: "kind must be one of: external_message, financial, destructive, external_write, other." };
  const action = checkField("proposedAction", T(500, 1), body.proposedAction);
  if (!action.ok || !action.value) return action.ok ? { ok: false, error: "proposedAction can't be empty." } : action;
  const context = body.context === undefined ? { ok: true as const, value: null } : checkField("context", T(4000), body.context);
  if (!context.ok) return context;
  if (typeof body.area !== "string" || !(AREAS as readonly string[]).includes(body.area)) return { ok: false, error: `area must be one of: ${AREAS.join(", ")}.` };
  const out: ApprovalRequest = { kind: body.kind as ApprovalRequest["kind"], proposedAction: action.value, context: context.value, area: body.area as Area };
  for (const k of ["runId", "taskId", "projectId", "goalId"] as const) {
    if (body[k] === undefined || body[k] === null) continue;
    if (!isUuid(body[k])) return { ok: false, error: `${k} must be a UUID.` };
    out[k] = (body[k] as string).toLowerCase();
  }
  if (body.expiresInHours !== undefined) {
    if (!(Number.isInteger(body.expiresInHours) && (body.expiresInHours as number) >= 1 && (body.expiresInHours as number) <= 24 * 30)) return { ok: false, error: "expiresInHours must be a whole number from 1 to 720." };
    out.expiresInHours = body.expiresInHours as number;
  }
  return { ok: true, value: out };
}

export interface NoteWrite {
  subjectTable: FactTable;
  subjectId: string;
  kind: (typeof NOTE_KINDS)[number];
  body: string;
  model?: string | null;
  runId?: string | null;
}

export function parseNoteWrite(body: unknown): Checked<NoteWrite> {
  if (!isObject(body)) return { ok: false, error: "The body must be a JSON object." };
  const extra = Object.keys(body).find((k) => !["subjectTable", "subjectId", "kind", "body", "model", "runId"].includes(k));
  if (extra) return { ok: false, error: `Unknown property "${extra.slice(0, 60)}".` };
  if (typeof body.subjectTable !== "string" || !isFactTable(body.subjectTable)) return { ok: false, error: `subjectTable must be one of: ${FACT_TABLES.join(", ")}.` };
  if (!isUuid(body.subjectId)) return { ok: false, error: "subjectId must be a UUID." };
  if (typeof body.kind !== "string" || !(NOTE_KINDS as readonly string[]).includes(body.kind)) return { ok: false, error: `kind must be one of: ${NOTE_KINDS.join(", ")}.` };
  const text = checkField("body", T(4000, 1), body.body);
  if (!text.ok || !text.value) return text.ok ? { ok: false, error: "body can't be empty." } : text;
  const model = checkField("model", T(120), body.model ?? null);
  if (!model.ok) return model;
  if (body.runId != null && !isUuid(body.runId)) return { ok: false, error: "runId must be a UUID." };
  return { ok: true, value: { subjectTable: body.subjectTable, subjectId: body.subjectId.toLowerCase(), kind: body.kind as NoteWrite["kind"], body: text.value, model: model.value, runId: (body.runId as string | undefined)?.toLowerCase() ?? null } };
}

export function parseDecision(body: unknown): Checked<{ decision: "approve" | "reject"; note: string | null }> {
  if (!isObject(body)) return { ok: false, error: "The body must be a JSON object." };
  if (body.decision !== "approve" && body.decision !== "reject") return { ok: false, error: 'decision must be "approve" or "reject".' };
  const note = checkField("note", T(1000), body.note ?? null);
  if (!note.ok) return note;
  return { ok: true, value: { decision: body.decision, note: note.value } };
}

// ---- What the page reads ------------------------------------------------------------------------

export interface RunRow {
  id: string;
  agent_id: string;
  workflow_id: string | null;
  status: RunStatus;
  result_summary: string | null;
  error: string | null;
  goal_id: string | null;
  project_id: string | null;
  task_id: string | null;
  cost_usd: string | null;
  started_at: string;
  finished_at: string | null;
}

export interface ApprovalRow {
  id: string;
  kind: ApprovalKind;
  proposed_action: string;
  context: string | null;
  area: Area;
  status: ApprovalStatus;
  requested_by: string;
  target_table: FactTable | null;
  target_id: string | null;
  /** fact_change only: the fields the agent wants to change, and the record version it saw. */
  payload: { fields: Values; baseVersion: number } | null;
  run_id: string | null;
  task_id: string | null;
  project_id: string | null;
  goal_id: string | null;
  created_at: string;
  expires_at: string | null;
}

export interface LinkRow {
  id: string;
  table: FactTable;
  label: string;
  status: string;
  area: Area;
  updated_at: string;
}

export type DataStatus =
  | { state: "not-configured"; need: string }
  | { state: "error"; message: string }
  | { state: "ok"; schemaVersion: number; agentKeys: number };

export interface DataOverview {
  status: Extract<DataStatus, { state: "ok" }>;
  runs: RunRow[];
  approvals: ApprovalRow[];
  /** Goals, projects and recent tasks, for names and links. */
  records: LinkRow[];
  counts: { runsFailed24h: number; runs24h: number; approvalsPending: number; tasksOpen: number };
}
