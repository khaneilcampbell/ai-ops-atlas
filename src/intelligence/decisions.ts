import type { Actor, SensitiveCategory } from "../tasks/types";
import { SENSITIVE_CATEGORIES } from "../tasks/types";
import { clean, isHttps, REASONING_KEYS, secretIn } from "./guard";
import { intelId, type IntelligenceStore, type Ok } from "./memory";
import type { DecisionRecord, EvidenceRef } from "./types";

// Decision records: what an agent recommends, on what evidence, under which constraints, with
// which alternatives and doubts, and who must approve it. Only concise, checkable summaries are
// kept; hidden reasoning is refused. High-impact, low-confidence or sensitive recommendations go
// to Khaneil for review before anyone acts on them.

export interface DecisionInput {
  agentId: string;
  recommendation: string;
  summary?: string;
  evidence: EvidenceRef[];
  constraints?: string[];
  alternatives?: string[];
  uncertainties?: string[];
  confidence: DecisionRecord["confidence"];
  impact: DecisionRecord["impact"];
  categories?: SensitiveCategory[];
  runId?: string;
  taskId?: string;
  nodeId?: string;
  workflowId?: string;
}

const list = (xs: string[] | undefined, n = 8) => (xs ?? []).map((x) => clean(x, 300)).filter(Boolean).slice(0, n);

/** Why the decision can't be recorded, or null. */
export function decisionProblem(input: DecisionInput & Record<string, unknown>): string | null {
  for (const k of REASONING_KEYS) if (k in input) return `Decision records keep a short summary only; "${k}" isn't stored.`;
  if (!input.recommendation?.trim()) return "A decision needs a recommendation.";
  if (input.recommendation.length > 600 || (input.summary?.length ?? 0) > 600) return "Keep the recommendation and summary under 600 characters each.";
  if (!input.evidence?.length) return "A recommendation needs at least one evidence reference.";
  for (const e of input.evidence) {
    if (!e.ref || !e.label) return "Every evidence item needs a label and a reference.";
    if (e.url && !isHttps(e.url)) return "Evidence links must be https.";
    if (/^https?:/.test(e.ref) && !isHttps(e.ref)) return "Evidence links must be https.";
  }
  if ((input.categories ?? []).some((c) => !SENSITIVE_CATEGORIES.includes(c))) return "Unknown approval category.";
  const text = [input.recommendation, input.summary ?? "", ...(input.constraints ?? []), ...(input.alternatives ?? []), ...(input.uncertainties ?? [])].join("\n");
  const secret = secretIn(text);
  if (secret) return `Refused: the text looks like it contains ${secret}.`;
  return null;
}

/** Who must approve, from fixed rules. Empty means no review is needed. */
export function requiredApprovals(input: Pick<DecisionInput, "impact" | "confidence" | "categories" | "evidence" | "uncertainties">): string[] {
  const out: string[] = [];
  if (input.categories?.length) out.push(`Khaneil: ${input.categories.join(", ").replace(/_/g, " ")}`);
  if (input.impact === "high") out.push("Khaneil: high impact");
  if (input.confidence === "low") out.push("Khaneil: low confidence");
  const unverified = input.evidence.filter((e) => e.verification !== "verified").length;
  if (input.impact !== "low" && unverified === input.evidence.length) out.push("Khaneil: no verified evidence");
  if (input.impact !== "low" && (input.uncertainties?.length ?? 0) >= 3) out.push("Khaneil: several open uncertainties");
  return out;
}

export function recordDecision(store: IntelligenceStore, input: DecisionInput, actor: Actor): Ok<{ decision: DecisionRecord }> {
  const problem = decisionProblem(input as DecisionInput & Record<string, unknown>);
  if (problem) return { ok: false, error: problem };
  if (actor.kind === "agent" && actor.id !== input.agentId) return { ok: false, error: "An agent records only its own decisions." };
  let decision!: DecisionRecord;
  const r = store.update((f, at) => {
    const approvals = requiredApprovals(input);
    decision = {
      id: intelId("dec"),
      agentId: input.agentId,
      ...(input.runId ? { runId: input.runId } : {}),
      ...(input.taskId ? { taskId: input.taskId } : {}),
      ...(input.nodeId ? { nodeId: input.nodeId } : {}),
      ...(input.workflowId ? { workflowId: input.workflowId } : {}),
      recommendation: clean(input.recommendation, 600),
      summary: clean(input.summary ?? "", 600),
      evidence: input.evidence.slice(0, 12).map((e) => ({ label: clean(e.label, 160), ref: clean(e.ref, 300), ...(e.url ? { url: e.url } : {}), verification: e.verification })),
      constraints: list(input.constraints),
      alternatives: list(input.alternatives),
      uncertainties: list(input.uncertainties),
      confidence: input.confidence,
      impact: input.impact,
      categories: input.categories ?? [],
      requiredApprovals: approvals,
      review: approvals.length ? "pending" : "not_needed",
      createdAt: at,
      createdBy: actor,
    };
    return store.audit({ ...f, decisions: [...f.decisions, decision] }, actor, "decision", [decision.id], at, approvals.length ? "escalated to Khaneil" : "recorded");
  });
  return r.ok ? { ok: true, decision } : r;
}

/** Only a person reviews a decision. */
export function reviewDecision(store: IntelligenceStore, id: string, actor: Actor, verdict: "approved" | "rejected", note = ""): Ok<object> {
  if (actor.kind !== "person") return { ok: false, error: "Only a person can review a recommendation." };
  const r = store.update((f, at) => {
    const i = f.decisions.findIndex((d) => d.id === id);
    if (i < 0) return "No such decision.";
    if (f.decisions[i].review !== "pending") return "This decision isn't waiting for review.";
    f.decisions[i] = { ...f.decisions[i], review: verdict, reviewedBy: actor.name, reviewedAt: at, ...(note ? { reviewNote: clean(note, 300) } : {}) };
    return store.audit(f, actor, "decision", [id], at, verdict);
  });
  return r.ok ? { ok: true } : r;
}

/** Records what actually happened after the decision, for later evaluation. */
export function recordDecisionOutcome(store: IntelligenceStore, id: string, actor: Actor, state: NonNullable<DecisionRecord["outcome"]>["state"], note: string): Ok<object> {
  if (actor.kind === "agent") return { ok: false, error: "An outcome is recorded by a person or by Atlas from measured results." };
  const r = store.update((f, at) => {
    const i = f.decisions.findIndex((d) => d.id === id);
    if (i < 0) return "No such decision.";
    f.decisions[i] = { ...f.decisions[i], outcome: { state, note: clean(note, 300), at, by: actor.name } };
    return store.audit(f, actor, "decision", [id], at, `outcome ${state}`);
  });
  return r.ok ? { ok: true } : r;
}
