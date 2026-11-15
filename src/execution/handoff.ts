import type { WorkflowDefinition } from "../workflows/types";
import { upstream } from "../workflows/graph";
import { ENVELOPE_VERSION, type ArtifactRef, type HandoffEnvelope, type HandoffRecord, type OutputValue, type StepOutput } from "./types";

// Handoffs: each step's output has a small fixed schema, checked deterministically at the
// boundary. Unknown fields are refused (no free-form data flows on to the next agent or into a
// privileged tool), long text is capped, documents travel as https artifact links. A bounded,
// deterministic repair (trim, "12" -> 12, "x" -> ["x"]) is tried once; nothing missing is ever
// filled in.

type FieldType = "string" | "number" | "boolean" | "string[]";
interface FieldSpec {
  type: FieldType;
  required?: boolean;
  /** For numbers: lowest allowed. For arrays: fewest items. */
  min?: number;
  max?: number;
  values?: readonly string[];
}
export interface OutputSchema {
  id: string;
  fields: Record<string, FieldSpec>;
  minArtifacts?: number;
}

const s = (required = true): FieldSpec => ({ type: "string", required });
const list = (min = 1, max = 20): FieldSpec => ({ type: "string[]", required: true, min, max });

/** One schema per Benjaire launch step (node id). Versioned in the id. */
export const OUTPUT_SCHEMAS: Record<string, OutputSchema> = {
  intake: { id: "goal-intake/1", fields: { goal: s(), budgetUsd: { type: "number", required: true, min: 0, max: 20 }, agents: list(1, 20) } },
  "market-research": { id: "market-research/1", fields: { ideas: list(1, 10), period: s(false) }, minArtifacts: 1 },
  "customer-research": { id: "customer-research/1", fields: { personas: list(1, 10), pains: list(1, 20) } },
  "competitor-analysis": { id: "competitor-analysis/1", fields: { competitors: list(1, 20), priceRange: s(false) } },
  scoring: { id: "opportunity-scores/1", fields: { rankings: list(1, 10), criteria: list(1, 10), topIdea: s() }, minArtifacts: 1 },
  viability: { id: "decision/1", fields: { branch: { type: "string", required: true, values: ["yes", "no"] }, reason: s(false) } },
  parked: { id: "parked/1", fields: { note: s(false) } },
  brief: { id: "product-brief/1", fields: { audience: s(), mvpScope: list(1, 15) }, minArtifacts: 1 },
  planning: { id: "product-plan/1", fields: { effortDays: { type: "number", required: true, min: 0, max: 365 }, risks: list(1, 15), audience: s() } },
  "approve-scope": { id: "approval/1", fields: { approvedBy: s() } },
  develop: { id: "development/1", fields: { repository: s(), build: { type: "string", required: true, values: ["passed", "failed"] }, tests: { type: "string", required: true, values: ["passed", "failed", "none"] } }, minArtifacts: 1 },
  quality: { id: "quality/1", fields: { passed: { type: "boolean", required: true }, notes: s(false) } },
  "approve-launch": { id: "approval/1", fields: { approvedBy: s() } },
  publish: { id: "publication/1", fields: { listing: s() }, minArtifacts: 1 },
  monitor: { id: "launch-outcome/1", fields: { summary: s() } },
};

const FREE: OutputSchema = { id: "step-summary/1", fields: { summary: s(false) } };
export const schemaFor = (nodeId: string): OutputSchema => OUTPUT_SCHEMAS[nodeId] ?? FREE;

const MAX_TEXT = 2000;
const MAX_ITEM = 500;
const MAX_ARTIFACTS = 20;
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

export function validArtifact(a: unknown): a is ArtifactRef {
  if (!a || typeof a !== "object") return false;
  const r = a as Partial<ArtifactRef>;
  if (typeof r.id !== "string" || typeof r.label !== "string" || typeof r.url !== "string") return false;
  try {
    return new URL(r.url).protocol === "https:" && r.label.length <= 200;
  } catch {
    return false;
  }
}

/** Every reason the output doesn't fit the step's schema; empty when it does. */
export function validateOutput(nodeId: string, out: unknown): string[] {
  const schema = schemaFor(nodeId);
  if (!out || typeof out !== "object") return ["No structured output was returned."];
  const o = out as Partial<StepOutput>;
  const errors: string[] = [];
  if (o.schema !== schema.id) errors.push(`Expected schema ${schema.id}, got ${String(o.schema ?? "none")}.`);
  const fields = o.fields && typeof o.fields === "object" ? o.fields : {};
  for (const k of Object.keys(fields)) if (!schema.fields[k]) errors.push(`Unexpected field "${k}".`);
  for (const [k, spec] of Object.entries(schema.fields)) {
    const v = (fields as Record<string, unknown>)[k];
    if (v === undefined || v === null || v === "") {
      if (spec.required) errors.push(`Missing "${k}".`);
      continue;
    }
    if (spec.type === "string") {
      if (typeof v !== "string") errors.push(`"${k}" must be text.`);
      else if (v.length > MAX_TEXT) errors.push(`"${k}" is longer than ${MAX_TEXT} characters; link a document instead.`);
      else if (CONTROL.test(v)) errors.push(`"${k}" has control characters.`);
      else if (spec.values && !spec.values.includes(v)) errors.push(`"${k}" must be one of ${spec.values.join(", ")}.`);
    } else if (spec.type === "number") {
      if (typeof v !== "number" || !Number.isFinite(v)) errors.push(`"${k}" must be a number.`);
      else if ((spec.min !== undefined && v < spec.min) || (spec.max !== undefined && v > spec.max)) errors.push(`"${k}" must be between ${spec.min ?? "-"} and ${spec.max ?? "-"}.`);
    } else if (spec.type === "boolean") {
      if (typeof v !== "boolean") errors.push(`"${k}" must be true or false.`);
    } else {
      if (!Array.isArray(v) || v.some((x) => typeof x !== "string")) errors.push(`"${k}" must be a list of text.`);
      else if (v.length < (spec.min ?? 0) || v.length > (spec.max ?? 50)) errors.push(`"${k}" needs ${spec.min ?? 0} to ${spec.max ?? 50} items.`);
      else if (v.some((x) => x.length > MAX_ITEM || CONTROL.test(x))) errors.push(`An item in "${k}" is too long or has control characters.`);
    }
  }
  const arts = Array.isArray(o.artifacts) ? o.artifacts : [];
  if (o.artifacts !== undefined && !Array.isArray(o.artifacts)) errors.push("Artifacts must be a list.");
  if (arts.length > MAX_ARTIFACTS) errors.push(`At most ${MAX_ARTIFACTS} artifacts.`);
  if (arts.some((a) => !validArtifact(a))) errors.push("Every artifact needs an id, a label and an https link.");
  if (arts.length < (schema.minArtifacts ?? 0)) errors.push(`Needs at least ${schema.minArtifacts} linked artifact${schema.minArtifacts === 1 ? "" : "s"}.`);
  return errors;
}

/**
 * The one safe repair: trims text, turns numeric text into numbers, a single text into a one-item
 * list and "true"/"false" into booleans, and fills in the schema id when the producer left it out.
 * Never adds a missing field or drops an unexpected one. Returns null when nothing changed.
 */
export function repairOutput(nodeId: string, out: unknown): StepOutput | null {
  if (!out || typeof out !== "object") return null;
  const schema = schemaFor(nodeId);
  const o = out as Partial<StepOutput>;
  let changed = false;
  const fields: Record<string, OutputValue> = {};
  for (const [k, v] of Object.entries(o.fields && typeof o.fields === "object" ? o.fields : {})) {
    const spec = schema.fields[k];
    let nv = v as OutputValue;
    if (typeof v === "string") nv = v.trim();
    if (spec?.type === "number" && typeof nv === "string" && /^-?\d+(\.\d+)?$/.test(nv)) nv = Number(nv);
    if (spec?.type === "boolean" && (nv === "true" || nv === "false")) nv = nv === "true";
    if (spec?.type === "string[]" && typeof nv === "string" && nv) nv = [nv];
    if (Array.isArray(nv)) nv = nv.map((x) => (typeof x === "string" ? x.trim() : x));
    if (JSON.stringify(nv) !== JSON.stringify(v)) changed = true;
    fields[k] = nv;
  }
  const schemaId = o.schema ?? schema.id;
  if (schemaId !== o.schema) changed = true;
  return changed ? { schema: schemaId, fields, artifacts: Array.isArray(o.artifacts) ? o.artifacts : [] } : null;
}

/** The envelope a step receives: its upstream steps' recorded outputs, nothing else. */
export function buildEnvelope(
  def: WorkflowDefinition,
  run: { id: string; nodeTasks: Record<string, string> },
  nodeId: string,
  attempt: { number: number; idempotencyKey: string },
  handoffs: Readonly<Record<string, HandoffRecord>>,
  at: string,
): HandoffEnvelope {
  const node = def.nodes.find((n) => n.id === nodeId);
  const ups = upstream(def, nodeId);
  const inputs: HandoffEnvelope["inputs"] = {};
  const artifacts: ArtifactRef[] = [];
  for (const u of ups) {
    const h = handoffs[u];
    if (!h) continue;
    inputs[u] = { schema: h.output?.schema ?? schemaFor(u).id, fields: h.output?.fields ?? {}, artifacts: h.output?.artifacts ?? [], ...(h.state === "waived" ? { waived: true } : {}), ...(h.state === "unverified" ? { unverified: true } : {}) };
    artifacts.push(...(h.output?.artifacts ?? []));
  }
  const sources = ups.map((u) => def.nodes.find((n) => n.id === u)?.agentId).filter((x): x is string => !!x);
  return {
    envelopeVersion: ENVELOPE_VERSION,
    runId: run.id,
    taskId: run.nodeTasks[nodeId] ?? "",
    nodeId,
    sourceAgentIds: [...new Set(sources)],
    destinationAgentId: node?.agentId ?? null,
    inputSchema: ups.map((u) => schemaFor(u).id).join("+") || "goal/1",
    outputSchema: schemaFor(nodeId).id,
    inputs,
    artifacts,
    correlationId: run.id,
    idempotencyKey: attempt.idempotencyKey,
    at,
  };
}
