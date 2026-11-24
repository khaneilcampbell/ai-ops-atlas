// Agent memory and task memory kept in PostgreSQL (db/migrations/0003_agent_memory.sql): the checks
// every memory write, review, pre-run check and feedback report passes, and the shapes the Task
// Center reads. Shared by the data API (server/memory/) and the page. Like records.ts, everything
// an agent sends is untrusted: unknown properties are refused, text is capped, ids are checked.

import { AREAS, ACCESS_CATEGORIES, isUuid, AGENT_ID, type AccessCategory, type Area, type Checked, type RunStatus } from "./records";

export const MEMORY_CATEGORIES = ["working", "operational", "project_knowledge", "human_approved"] as const;
export type MemoryCategory = (typeof MEMORY_CATEGORIES)[number];
/** What agents may write. The other two are Khaneil's. */
export const AGENT_MEMORY_CATEGORIES: readonly MemoryCategory[] = ["working", "operational"];
export const MEMORY_KINDS = ["fact", "procedure", "lesson", "context"] as const;
export type MemoryKind = (typeof MEMORY_KINDS)[number];
export const SOURCE_KINDS = ["run", "task", "decision", "document", "repository", "person", "agent", "external"] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];
export const VERIFICATIONS = ["unverified", "verified", "disputed"] as const;
export type Verification = (typeof VERIFICATIONS)[number];
export const VERDICTS = ["passed", "partial", "failed", "unverified"] as const;
export type Verdict = (typeof VERDICTS)[number];
export const PREPARE_DECISIONS = ["create", "update", "skip", "wait", "resume", "retry", "backoff", "escalate"] as const;
export type PrepareDecision = (typeof PREPARE_DECISIONS)[number];

export const MEMORY_CATEGORY_LABEL: Record<MemoryCategory, string> = { working: "Working", operational: "Operational", project_knowledge: "Project knowledge", human_approved: "Approved by you" };
export const MEMORY_KIND_LABEL: Record<MemoryKind, string> = { fact: "Fact", procedure: "Procedure", lesson: "Lesson", context: "Context" };
export const DECISION_LABEL: Record<PrepareDecision, string> = {
  create: "Start new work",
  update: "Update the open task",
  skip: "Skip: already done",
  wait: "Wait: already running",
  resume: "Resume from the next step",
  retry: "Retry now",
  backoff: "Retry later",
  escalate: "Needs you",
};

/** Working memory lives 7 days by default and 30 at most. Reviewed memory shows as stale after these days. */
export const WORKING_TTL_DAYS = 7;
export const WORKING_MAX_TTL_DAYS = 30;
export const REVIEW_DAYS: Record<MemoryCategory, number | null> = { working: null, operational: 90, project_knowledge: 180, human_approved: null };
/** Retrieval budget: what one pre-run check may hand an agent. */
export const DEFAULT_BUDGET_TOKENS = 1500;
export const MAX_BUDGET_TOKENS = 4000;
export const MAX_CONTEXT_ITEMS = 8;
/** Retries: at most this many attempts per task key, waiting 2, 8, 32... minutes (capped at 2 hours). */
export const MAX_ATTEMPTS = 4;
export const BACKOFF_BASE_MIN = 2;
export const BACKOFF_CAP_MIN = 120;
/** A run with no lease that hasn't reported for this long is marked timed out. */
export const STALE_AFTER_MIN = 120;
/** A finished run younger than this (hours) counts as "already done" unless the caller says otherwise. */
export const DEFAULT_FRESH_HOURS = 20;

/** Minutes to wait before attempt `next` (2, 8, 32, 120...). Bounded, so a broken job can't hammer anything. */
export const backoffMinutes = (next: number) => Math.min(BACKOFF_CAP_MIN, BACKOFF_BASE_MIN * 4 ** Math.max(0, next - 2));

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
const ERROR_CLASS = /^[a-z0-9][a-z0-9_.-]{0,59}$/;
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const extraKey = (body: Record<string, unknown>, allowed: readonly string[]) => Object.keys(body).find((k) => !allowed.includes(k));

function text(name: string, v: unknown, max: number, min = 0): Checked<string | null> {
  if (v === undefined || v === null) return min ? { ok: false, error: `${name} is required.` } : { ok: true, value: null };
  if (typeof v !== "string" || CONTROL.test(v)) return { ok: false, error: `${name} must be plain text.` };
  const s = v.trim();
  if (s.length < min) return { ok: false, error: `${name} can't be empty.` };
  if (s.length > max) return { ok: false, error: `${name} is longer than ${max} characters.` };
  return { ok: true, value: s || null };
}
const oneOf = <T extends string>(name: string, v: unknown, values: readonly T[]): Checked<T> =>
  typeof v === "string" && (values as readonly string[]).includes(v) ? { ok: true, value: v as T } : { ok: false, error: `${name} must be one of: ${values.join(", ")}.` };
function optUuid(name: string, v: unknown): Checked<string | null> {
  if (v === undefined || v === null) return { ok: true, value: null };
  return isUuid(v) ? { ok: true, value: v.toLowerCase() } : { ok: false, error: `${name} must be a UUID.` };
}
function optKey(name: string, v: unknown): Checked<string | null> {
  if (v === undefined || v === null) return { ok: true, value: null };
  return typeof v === "string" && /^[A-Za-z0-9._:-]{3,160}$/.test(v) ? { ok: true, value: v } : { ok: false, error: `${name} must be 3–160 letters, digits or . _ : -` };
}
function optHttps(name: string, v: unknown): Checked<string | null> {
  if (v === undefined || v === null) return { ok: true, value: null };
  if (typeof v !== "string" || v.length > 2000) return { ok: false, error: `${name} must be an https link.` };
  try {
    const u = new URL(v);
    if (u.protocol !== "https:" || u.username || u.password) return { ok: false, error: `${name} must be an https link without a user name or password.` };
  } catch {
    return { ok: false, error: `${name} isn't a valid link.` };
  }
  return { ok: true, value: v };
}
function tagsOf(v: unknown): Checked<string[]> {
  if (v === undefined || v === null) return { ok: true, value: [] };
  if (!Array.isArray(v) || v.length > 12 || v.some((t) => typeof t !== "string" || !/^[a-z0-9][a-z0-9_.-]{0,39}$/i.test(t))) return { ok: false, error: "tags must be up to 12 short words (letters, digits, - _ .)." };
  return { ok: true, value: [...new Set((v as string[]).map((t) => t.toLowerCase()))] };
}

// ---- Memory writes --------------------------------------------------------------------------------

export interface MemoryWrite {
  category: MemoryCategory;
  kind: MemoryKind;
  title: string;
  content: string;
  tags: string[];
  area: Area;
  /** Keep it to the writing agent only (default for agents' working memory). */
  private: boolean;
  projectId: string | null;
  goalId: string | null;
  workflowId: string | null;
  taskKey: string | null;
  errorClass: string | null;
  sensitivity: AccessCategory;
  source: { kind: SourceKind; ref: string; url: string | null };
  runId: string | null;
  ttlDays: number | null;
}

const MEMORY_KEYS = ["category", "kind", "title", "content", "tags", "area", "private", "projectId", "goalId", "workflowId", "taskKey", "errorClass", "sensitivity", "source", "runId", "ttlDays"];

export function parseMemoryWrite(body: unknown): Checked<MemoryWrite> {
  if (!isObject(body)) return { ok: false, error: "The body must be a JSON object." };
  const extra = extraKey(body, MEMORY_KEYS);
  if (extra) return { ok: false, error: `Unknown property "${extra.slice(0, 60)}".` };
  const category = oneOf("category", body.category, MEMORY_CATEGORIES);
  if (!category.ok) return category;
  const kind = body.kind === undefined ? ({ ok: true, value: "fact" } as const) : oneOf("kind", body.kind, MEMORY_KINDS);
  if (!kind.ok) return kind;
  const title = text("title", body.title, 160, 1);
  if (!title.ok) return title;
  const content = text("content", body.content, 2000, 1);
  if (!content.ok) return content;
  const tags = tagsOf(body.tags);
  if (!tags.ok) return tags;
  const area = oneOf("area", body.area, AREAS);
  if (!area.ok) return area;
  const sensitivity = body.sensitivity === undefined ? ({ ok: true, value: "internal" } as const) : oneOf("sensitivity", body.sensitivity, ACCESS_CATEGORIES);
  if (!sensitivity.ok) return sensitivity;
  if (!isObject(body.source)) return { ok: false, error: "source is required: { kind, ref, url? } saying where this came from." };
  if (extraKey(body.source, ["kind", "ref", "url"])) return { ok: false, error: "source takes kind, ref and url only." };
  const sKind = oneOf("source.kind", body.source.kind, SOURCE_KINDS);
  if (!sKind.ok) return sKind;
  const sRef = text("source.ref", body.source.ref, 500, 1);
  if (!sRef.ok) return sRef;
  const sUrl = optHttps("source.url", body.source.url);
  if (!sUrl.ok) return sUrl;
  const ids: Record<string, string | null> = {};
  for (const k of ["projectId", "goalId", "runId"] as const) {
    const c = optUuid(k, body[k]);
    if (!c.ok) return c;
    ids[k] = c.value;
  }
  const taskKey = optKey("taskKey", body.taskKey);
  if (!taskKey.ok) return taskKey;
  const workflowId = text("workflowId", body.workflowId, 120);
  if (!workflowId.ok) return workflowId;
  if (body.errorClass !== undefined && body.errorClass !== null && (typeof body.errorClass !== "string" || !ERROR_CLASS.test(body.errorClass))) return { ok: false, error: "errorClass must be a short lower-case slug like n8n.timeout." };
  if (body.private !== undefined && typeof body.private !== "boolean") return { ok: false, error: "private must be true or false." };
  if (body.ttlDays !== undefined && body.ttlDays !== null && !(Number.isInteger(body.ttlDays) && (body.ttlDays as number) >= 1 && (body.ttlDays as number) <= WORKING_MAX_TTL_DAYS)) return { ok: false, error: `ttlDays must be a whole number from 1 to ${WORKING_MAX_TTL_DAYS}.` };
  return {
    ok: true,
    value: {
      category: category.value,
      kind: kind.value,
      title: title.value!,
      content: content.value!,
      tags: tags.value,
      area: area.value,
      private: (body.private as boolean | undefined) ?? category.value === "working",
      projectId: ids.projectId,
      goalId: ids.goalId,
      runId: ids.runId,
      workflowId: workflowId.value,
      taskKey: taskKey.value,
      errorClass: (body.errorClass as string | null | undefined) ?? null,
      sensitivity: sensitivity.value,
      source: { kind: sKind.value, ref: sRef.value!, url: sUrl.value },
      ttlDays: (body.ttlDays as number | null | undefined) ?? null,
    },
  };
}

// ---- Review (Khaneil only) ------------------------------------------------------------------------

export type MemoryReview =
  | { action: "verify" | "dispute"; note: string | null }
  | { action: "retire"; note: string }
  | { action: "revise"; note: string | null; title: string | null; content: string | null; tags: string[] | null };

export function parseMemoryReview(body: unknown): Checked<MemoryReview> {
  if (!isObject(body)) return { ok: false, error: "The body must be a JSON object." };
  const extra = extraKey(body, ["action", "note", "title", "content", "tags"]);
  if (extra) return { ok: false, error: `Unknown property "${extra.slice(0, 60)}".` };
  const action = oneOf("action", body.action, ["verify", "dispute", "retire", "revise"] as const);
  if (!action.ok) return action;
  const note = text("note", body.note, 200, action.value === "retire" ? 1 : 0);
  if (!note.ok) return note;
  if (action.value === "retire") return { ok: true, value: { action: "retire", note: note.value! } };
  if (action.value !== "revise") {
    if (body.title !== undefined || body.content !== undefined || body.tags !== undefined) return { ok: false, error: "Only a revision changes title, content or tags." };
    return { ok: true, value: { action: action.value, note: note.value } };
  }
  const title = text("title", body.title, 160);
  if (!title.ok) return title;
  const content = text("content", body.content, 2000);
  if (!content.ok) return content;
  const tags = body.tags === undefined ? ({ ok: true, value: null } as const) : tagsOf(body.tags);
  if (!tags.ok) return tags;
  if (!title.value && !content.value && !tags.value) return { ok: false, error: "A revision needs a new title, content or tags." };
  return { ok: true, value: { action: "revise", note: note.value, title: title.value, content: content.value, tags: tags.value } };
}

// ---- Pre-run check ("prepare") --------------------------------------------------------------------

export interface PrepareRequest {
  agentId: string;
  /** Stable name of the job, the same every time it recurs: e.g. "task-desk:daily-scan:2026-11-22". */
  taskKey: string;
  /** What the run is for, in plain words. Used to find related memory. */
  objective: string;
  area: Area;
  projectId: string | null;
  goalId: string | null;
  workflowId: string | null;
  /** For a multi-step objective: the step names in order. Each step is the task key "<taskKey>:<step>". */
  steps: string[];
  /** A finished run younger than this counts as already done. 0 means always run again. */
  freshHours: number;
  budgetTokens: number;
  tags: string[];
}

export function parsePrepare(body: unknown): Checked<PrepareRequest> {
  if (!isObject(body)) return { ok: false, error: "The body must be a JSON object." };
  const extra = extraKey(body, ["agentId", "taskKey", "objective", "area", "projectId", "goalId", "workflowId", "steps", "freshHours", "budgetTokens", "tags"]);
  if (extra) return { ok: false, error: `Unknown property "${extra.slice(0, 60)}".` };
  if (typeof body.agentId !== "string" || !AGENT_ID.test(body.agentId)) return { ok: false, error: "agentId must be lower-case letters, digits and dashes." };
  const taskKey = optKey("taskKey", body.taskKey);
  if (!taskKey.ok) return taskKey;
  if (!taskKey.value) return { ok: false, error: "taskKey is required: a stable name for this job, the same each time it recurs." };
  if (taskKey.value.length > 100) return { ok: false, error: "taskKey must be at most 100 characters (run keys add the step and attempt)." };
  const objective = text("objective", body.objective, 500, 1);
  if (!objective.ok) return objective;
  const area = oneOf("area", body.area, AREAS);
  if (!area.ok) return area;
  const projectId = optUuid("projectId", body.projectId);
  if (!projectId.ok) return projectId;
  const goalId = optUuid("goalId", body.goalId);
  if (!goalId.ok) return goalId;
  const workflowId = text("workflowId", body.workflowId, 120);
  if (!workflowId.ok) return workflowId;
  let steps: string[] = [];
  if (body.steps !== undefined) {
    if (!Array.isArray(body.steps) || body.steps.length > 20 || body.steps.some((s) => typeof s !== "string" || !/^[A-Za-z0-9._-]{1,20}$/.test(s))) return { ok: false, error: "steps must be up to 20 names of 1–20 letters, digits, . _ or -." };
    steps = body.steps as string[];
    if (new Set(steps).size !== steps.length) return { ok: false, error: "Each step name must be different." };
  }
  const freshHours = body.freshHours === undefined ? DEFAULT_FRESH_HOURS : body.freshHours;
  if (!(typeof freshHours === "number" && Number.isFinite(freshHours) && freshHours >= 0 && freshHours <= 24 * 90)) return { ok: false, error: "freshHours must be a number from 0 to 2160." };
  const budget = body.budgetTokens === undefined ? DEFAULT_BUDGET_TOKENS : body.budgetTokens;
  if (!(Number.isInteger(budget) && (budget as number) >= 0 && (budget as number) <= MAX_BUDGET_TOKENS)) return { ok: false, error: `budgetTokens must be a whole number from 0 to ${MAX_BUDGET_TOKENS}.` };
  const tags = tagsOf(body.tags);
  if (!tags.ok) return tags;
  return { ok: true, value: { agentId: body.agentId, taskKey: taskKey.value, objective: objective.value!, area: area.value, projectId: projectId.value, goalId: goalId.value, workflowId: workflowId.value, steps, freshHours, budgetTokens: budget as number, tags: tags.value } };
}

// ---- Feedback -------------------------------------------------------------------------------------

export interface Check {
  name: string;
  passed: boolean;
  detail?: string;
}

export interface FeedbackWrite {
  runId: string;
  verdict: Verdict;
  checks: Check[];
  qualityScore: number | null;
  errorClass: string | null;
  retryable: boolean | null;
  memoryIds: string[];
  note: string | null;
  /** Something worth remembering. Always stored unverified, whatever the verdict. */
  lesson: { kind: "lesson" | "procedure"; title: string; content: string; tags: string[]; area: Area } | null;
}

export function parseFeedback(body: unknown): Checked<FeedbackWrite> {
  if (!isObject(body)) return { ok: false, error: "The body must be a JSON object." };
  const extra = extraKey(body, ["runId", "verdict", "checks", "qualityScore", "errorClass", "retryable", "memoryIds", "note", "lesson"]);
  if (extra) return { ok: false, error: `Unknown property "${extra.slice(0, 60)}".` };
  if (!isUuid(body.runId)) return { ok: false, error: "runId must be a UUID." };
  const verdict = oneOf("verdict", body.verdict, VERDICTS);
  if (!verdict.ok) return verdict;
  const checks: Check[] = [];
  if (body.checks !== undefined) {
    if (!Array.isArray(body.checks) || body.checks.length > 20) return { ok: false, error: "checks must be a list of up to 20 { name, passed, detail? }." };
    for (const c of body.checks) {
      if (!isObject(c) || extraKey(c, ["name", "passed", "detail"]) || typeof c.passed !== "boolean") return { ok: false, error: "Each check is { name, passed: true|false, detail? }." };
      const name = text("check name", c.name, 80, 1);
      if (!name.ok) return name;
      const detail = text("check detail", c.detail, 200);
      if (!detail.ok) return detail;
      checks.push({ name: name.value!, passed: c.passed, ...(detail.value ? { detail: detail.value } : {}) });
    }
  }
  if (body.qualityScore !== undefined && body.qualityScore !== null && !(Number.isInteger(body.qualityScore) && (body.qualityScore as number) >= 0 && (body.qualityScore as number) <= 100)) return { ok: false, error: "qualityScore must be a whole number from 0 to 100." };
  if (body.errorClass !== undefined && body.errorClass !== null && (typeof body.errorClass !== "string" || !ERROR_CLASS.test(body.errorClass))) return { ok: false, error: "errorClass must be a short lower-case slug like n8n.timeout." };
  if (body.retryable !== undefined && body.retryable !== null && typeof body.retryable !== "boolean") return { ok: false, error: "retryable must be true or false." };
  if (body.memoryIds !== undefined && (!Array.isArray(body.memoryIds) || body.memoryIds.length > 20 || !body.memoryIds.every(isUuid))) return { ok: false, error: "memoryIds must be up to 20 memory UUIDs." };
  const note = text("note", body.note, 1000);
  if (!note.ok) return note;
  let lesson: FeedbackWrite["lesson"] = null;
  if (body.lesson !== undefined && body.lesson !== null) {
    if (!isObject(body.lesson) || extraKey(body.lesson, ["kind", "title", "content", "tags", "area"])) return { ok: false, error: "lesson is { kind: lesson|procedure, title, content, area, tags? }." };
    const la = oneOf("lesson.area", body.lesson.area, AREAS);
    if (!la.ok) return la;
    const k = oneOf("lesson.kind", body.lesson.kind ?? "lesson", ["lesson", "procedure"] as const);
    if (!k.ok) return k;
    const t = text("lesson.title", body.lesson.title, 160, 1);
    if (!t.ok) return t;
    const c = text("lesson.content", body.lesson.content, 2000, 1);
    if (!c.ok) return c;
    const tg = tagsOf(body.lesson.tags);
    if (!tg.ok) return tg;
    lesson = { kind: k.value, title: t.value!, content: c.value!, tags: tg.value, area: la.value };
  }
  return {
    ok: true,
    value: {
      runId: body.runId.toLowerCase(),
      verdict: verdict.value,
      checks,
      qualityScore: (body.qualityScore as number | null | undefined) ?? null,
      errorClass: (body.errorClass as string | null | undefined) ?? null,
      retryable: (body.retryable as boolean | null | undefined) ?? null,
      memoryIds: ((body.memoryIds as string[] | undefined) ?? []).map((x) => x.toLowerCase()),
      note: note.value,
      lesson,
    },
  };
}

/**
 * The verdict Atlas keeps. "passed" needs measurable checks that all passed; an agent saying it
 * passed without any check is kept as "unverified", and a failed check can't be called a pass.
 */
export function settledVerdict(claimed: Verdict, checks: readonly Check[]): Verdict {
  if (claimed !== "passed") return claimed;
  if (!checks.length) return "unverified";
  return checks.every((c) => c.passed) ? "passed" : "partial";
}

/** 0 to 1: verified, reviewed recently and used before is high; unverified, stale or held text is low. */
export function confidenceOf(m: { verification: Verification; review_at: string | null; suspicious: string | null; use_count: number }, now: number): number {
  let c = m.verification === "verified" ? 0.9 : m.verification === "disputed" ? 0 : 0.5;
  if (m.review_at && Date.parse(m.review_at) <= now) c *= 0.6;
  if (m.suspicious) c *= 0.3;
  if (m.use_count >= 3 && m.verification === "verified") c = Math.min(1, c + 0.05);
  return Math.round(c * 100) / 100;
}

// ---- What the page and agents read ----------------------------------------------------------------

export interface MemoryRow {
  id: string;
  category: MemoryCategory;
  kind: MemoryKind;
  title: string;
  content: string;
  tags: string[];
  area: Area;
  agent_id: string | null;
  task_key: string | null;
  workflow_id: string | null;
  error_class: string | null;
  source_kind: SourceKind;
  source_ref: string;
  source_url: string | null;
  run_id: string | null;
  verification: Verification;
  verified_by: string | null;
  verified_at: string | null;
  suspicious: string | null;
  supersedes: string | null;
  expires_at: string | null;
  review_at: string | null;
  use_count: number;
  last_used_at: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  version: number;
}

/** One item handed to an agent: marked as data, with where it came from and how far to trust it. */
export interface ContextItem {
  id: string;
  kind: MemoryKind;
  category: MemoryCategory;
  title: string;
  text: string;
  source: string;
  verification: Verification;
  /** 0 to 1: verified and recently used or reviewed is high; unverified, disputed or stale is low. */
  confidence: number;
  /** Past its review date. */
  stale: boolean;
  ageDays: number;
  tokens: number;
}

export interface PriorRun {
  id: string;
  task_key: string | null;
  attempt: number;
  status: RunStatus;
  external_run_id: string | null;
  result_summary: string | null;
  error: string | null;
  started_at: string;
  finished_at: string | null;
  verdict: Verdict | null;
  error_class: string | null;
  retryable: boolean | null;
}

export interface StepState {
  step: string;
  taskKey: string;
  state: "done" | "running" | "failed" | "todo";
  runId: string | null;
  resultSummary: string | null;
}

export interface PrepareAnswer {
  decision: PrepareDecision;
  /** Plain words on why, for logs and the Task Center. */
  reason: string;
  taskKey: string;
  /** For create / retry / resume: the attempt number and the run key to record the run under. */
  attempt: number;
  runKey: string;
  retryAt: string | null;
  /** An open task with this key, when there is one. */
  openTask: { id: string; title: string; status: string } | null;
  /** The run that makes this a skip, wait or retry. */
  relatedRun: PriorRun | null;
  priorRuns: PriorRun[];
  steps: StepState[];
  nextStep: string | null;
  /** Verified procedures for this job: trusted methods to reuse. */
  procedures: ContextItem[];
  /** Lessons from earlier failures of this job (verified first). */
  failureLessons: ContextItem[];
  context: { note: string; items: ContextItem[]; usedTokens: number; budgetTokens: number; dropped: Record<string, number> };
  tokensSavedEstimate: number;
}

export interface MemoryOverview {
  counts: { live: number; verified: number; unverified: number; disputed: number; procedures: number; staleReview: number };
  /** Agent-written memory waiting for Khaneil to verify, newest first. */
  toReview: MemoryRow[];
  /** Pre-run checks in the last 30 days, by decision. */
  decisions30d: Partial<Record<PrepareDecision, number>>;
  tokensSaved30d: number;
  runsTimedOut: number;
  lastSweep: string | null;
}

export interface AgentMemory {
  agentId: string;
  memory: MemoryRow[];
  runs: (PriorRun & { duration_ms: number | null; quality_score: number | null; cost_usd: string | null })[];
  performance: { runs30d: number; succeeded30d: number; failed30d: number; timedOut30d: number; passedChecks30d: number; medianDurationMs: number | null; costUsd30d: number; tokensSaved30d: number; duplicatesPrevented30d: number };
  related: { taskKey: string; runs: number; lastStatus: RunStatus; lastAt: string }[];
}
