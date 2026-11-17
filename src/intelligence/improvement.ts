import type { Actor } from "../tasks/types";
import { clean, secretIn } from "./guard";
import { intelId, type IntelligenceStore, type Ok } from "./memory";
import { PROPOSAL_KINDS, type AgentVersion, type Evaluation, type Feedback, type ImprovementProposal, type ProposalKind } from "./types";

// Continuous improvement, always through a person:
//   execution -> evaluation -> feedback -> improvement proposal -> human review -> versioned update
// Agents and Atlas may propose prompt, knowledge-source, workflow and validation changes. They can
// never propose (let alone make) changes to permissions, security rules, approval requirements or
// deployment settings; those are refused at the door. Only Khaneil approves, records where the
// change was applied, and rolls it back. Every applied change is a numbered version per agent.

/** Things only Khaneil changes, directly. A proposal from an agent or Atlas that touches them is refused. */
const PROTECTED: [RegExp, string][] = [
  [/\bpermission|\bgrant (access|tool)|\bscope[sd]? (up|to)\b|\bauthori[sz]ation\b/i, "permissions"],
  [/\bsecurity rule|\bfirewall|\bcsp\b|\bsecret|\bcredential|\bapi key|\btoken\b/i, "security rules or credentials"],
  [/\b(skip|remove|bypass|waive|disable|drop)\b[^.]{0,40}\bapproval|\bapproval (requirement|gate|step)s?\b[^.]{0,30}\b(remove|skip|drop|disable)/i, "approval requirements"],
  [/\bdeploy(ment)?s?\b[^.]{0,30}\b(config|setting|pipeline|automatic|auto)|\bauto-?merge\b|\bpublish (automatically|without)/i, "deployment settings"],
];

export function protectedTarget(text: string): string | null {
  for (const [re, what] of PROTECTED) if (re.test(text)) return what;
  return null;
}

export interface ProposalInput {
  agentId: string;
  kind: ProposalKind;
  title: string;
  change: string;
  rationale: string;
  evidenceIds?: string[];
}

export function proposalProblem(input: ProposalInput, actor: Actor): string | null {
  if (!PROPOSAL_KINDS.includes(input.kind)) return "A proposal is a prompt, knowledge source, workflow or validation change.";
  if (!input.title.trim() || !input.change.trim()) return "A proposal needs a title and the change.";
  if (input.change.length > 1500) return "Describe the change in under 1,500 characters.";
  const text = `${input.title}\n${input.change}\n${input.rationale}`;
  const secret = secretIn(text);
  if (secret) return `Refused: the text looks like it contains ${secret}.`;
  if (actor.kind !== "person") {
    const target = protectedTarget(text);
    if (target) return `Agents and Atlas can't propose changes to ${target}. Khaneil changes those directly.`;
    if (actor.kind === "agent" && actor.id !== input.agentId) return "An agent proposes changes only for itself.";
  }
  return null;
}

export function propose(store: IntelligenceStore, input: ProposalInput, actor: Actor): Ok<{ proposal: ImprovementProposal }> {
  const problem = proposalProblem(input, actor);
  if (problem) {
    store.update((f, at) => store.audit(f, actor, "refused", [], at, problem));
    return { ok: false, error: problem };
  }
  let proposal!: ImprovementProposal;
  const r = store.update((f, at) => {
    if (f.proposals.some((p) => p.agentId === input.agentId && p.title === clean(input.title, 160) && p.state === "proposed")) return "The same proposal is already waiting for review.";
    proposal = {
      id: intelId("prop"),
      agentId: input.agentId,
      kind: input.kind,
      title: clean(input.title, 160),
      change: clean(input.change, 1500),
      rationale: clean(input.rationale, 600),
      evidenceIds: (input.evidenceIds ?? []).slice(0, 20),
      proposedBy: actor,
      createdAt: at,
      state: "proposed",
    };
    return store.audit({ ...f, proposals: [...f.proposals, proposal] }, actor, "proposal", [proposal.id], at, "proposed");
  });
  return r.ok ? { ok: true, proposal } : r;
}

export function reviewProposal(store: IntelligenceStore, id: string, actor: Actor, verdict: "approved" | "rejected", note = ""): Ok<object> {
  if (actor.kind !== "person") return { ok: false, error: "Only Khaneil reviews improvement proposals." };
  const r = store.update((f, at) => {
    const i = f.proposals.findIndex((p) => p.id === id);
    if (i < 0) return "No such proposal.";
    if (f.proposals[i].state !== "proposed") return "This proposal was already reviewed.";
    f.proposals[i] = { ...f.proposals[i], state: verdict, reviewedBy: actor.name, reviewedAt: at, ...(note ? { reviewNote: clean(note, 300) } : {}) };
    return store.audit(f, actor, "proposal", [id], at, verdict);
  });
  return r.ok ? { ok: true } : r;
}

/**
 * Records an approved proposal as the agent's next version. Atlas can't edit n8n prompts (its key
 * is read-only) or the repository, so `appliedIn` says where Khaneil made the change.
 */
export function applyProposal(store: IntelligenceStore, id: string, actor: Actor, appliedIn: string): Ok<{ version: AgentVersion }> {
  if (actor.kind !== "person") return { ok: false, error: "Only Khaneil applies a change." };
  if (!appliedIn.trim()) return { ok: false, error: "Say where the change was made (an n8n version, a pull request)." };
  let version!: AgentVersion;
  const r = store.update((f, at) => {
    const i = f.proposals.findIndex((p) => p.id === id);
    if (i < 0) return "No such proposal.";
    const p = f.proposals[i];
    if (p.state !== "approved") return "Only an approved proposal can be applied.";
    const n = Math.max(0, ...f.versions.filter((v) => v.agentId === p.agentId).map((v) => v.version)) + 1;
    version = { id: intelId("ver"), agentId: p.agentId, kind: p.kind, version: n, proposalId: p.id, change: p.change, appliedBy: actor.name, at, appliedIn: clean(appliedIn, 200) };
    f.proposals[i] = { ...p, state: "applied", version: n };
    return store.audit({ ...f, versions: [...f.versions, version] }, actor, "version", [version.id, p.id], at, `v${n}`);
  });
  return r.ok ? { ok: true, version } : r;
}

/** Marks a version rolled back. The history keeps both; nothing is deleted. */
export function rollback(store: IntelligenceStore, versionId: string, actor: Actor): Ok<object> {
  if (actor.kind !== "person") return { ok: false, error: "Only Khaneil rolls back a change." };
  const r = store.update((f, at) => {
    const i = f.versions.findIndex((v) => v.id === versionId);
    if (i < 0) return "No such version.";
    if (f.versions[i].rolledBackAt) return "Already rolled back.";
    f.versions[i] = { ...f.versions[i], rolledBackAt: at, rolledBackBy: actor.name };
    const pi = f.proposals.findIndex((p) => p.id === f.versions[i].proposalId);
    if (pi >= 0) f.proposals[pi] = { ...f.proposals[pi], state: "rolled_back" };
    return store.audit(f, actor, "version", [versionId], at, "rolled back");
  });
  return r.ok ? { ok: true } : r;
}

/** A person's rating of a task's output. It goes on the evaluation too, kept apart from the automatic score. */
export function giveFeedback(store: IntelligenceStore, input: { taskId: string; agentId: string; rating: Feedback["rating"]; note: string }, actor: Actor): Ok<{ feedback: Feedback }> {
  if (actor.kind !== "person") return { ok: false, error: "Feedback comes from a person." };
  if (![1, 2, 3, 4, 5].includes(input.rating)) return { ok: false, error: "Rate from 1 to 5." };
  const secret = secretIn(input.note);
  if (secret) return { ok: false, error: `Refused: the note looks like it contains ${secret}.` };
  let feedback!: Feedback;
  const r = store.update((f, at) => {
    const evals = f.evaluations.filter((e) => e.taskId === input.taskId);
    const latest = evals[evals.length - 1];
    feedback = { id: intelId("fb"), taskId: input.taskId, ...(latest ? { evaluationId: latest.id } : {}), agentId: input.agentId, rating: input.rating, note: clean(input.note, 600), by: actor.name, at };
    const evaluations = latest ? f.evaluations.map((e) => (e.id === latest.id ? { ...e, human: { rating: input.rating, note: feedback.note, by: actor.name, at } } : e)) : f.evaluations;
    return store.audit({ ...f, feedback: [...f.feedback, feedback], evaluations }, actor, "feedback", [feedback.id], at, `rating ${input.rating}`);
  });
  return r.ok ? { ok: true, feedback } : r;
}

export interface Suggestion {
  agentId: string;
  kind: ProposalKind;
  title: string;
  change: string;
  rationale: string;
  evidenceIds: string[];
}

/**
 * Improvement suggestions from evaluations and feedback, by fixed thresholds. Shown to Khaneil;
 * turning one into a proposal is one click, and it still needs review.
 */
export function suggest(evals: readonly Evaluation[], feedback: readonly Feedback[], agentId?: string): Suggestion[] {
  const out: Suggestion[] = [];
  const agents = [...new Set([...evals.map((e) => e.agentId), ...feedback.map((f) => f.agentId)])].filter((a) => !agentId || a === agentId);
  for (const a of agents) {
    const mine = evals.filter((e) => e.agentId === a).slice(-10);
    const invalid = mine.filter((e) => e.metrics.outputValid !== null && e.metrics.outputValid < 1);
    if (invalid.length >= 2)
      out.push({ agentId: a, kind: "validation", title: "Tighten the output format instructions", change: "Restate the exact output schema (field names, item counts, https artifact links) at the end of the step's instructions, and return nothing outside it.", rationale: `${invalid.length} of the last ${mine.length} outputs failed the schema check before passing.`, evidenceIds: invalid.map((e) => e.id) });
    const thin = mine.filter((e) => e.metrics.evidence !== null && e.metrics.evidence < 1);
    if (thin.length >= 2)
      out.push({ agentId: a, kind: "knowledge_source", title: "Require linked sources for every claim", change: "Ask for at least one dated https source per idea or claim, and link the full report as an artifact.", rationale: `${thin.length} recent outputs had fewer linked artifacts than the schema asks for.`, evidenceIds: thin.map((e) => e.id) });
    const over = mine.filter((e) => e.flags.some((f) => f.includes("the route is tier")));
    if (over.length >= 2)
      out.push({ agentId: a, kind: "workflow", title: "Use the routed model tier", change: "Run this step on the tier the route gives (a lightweight model for bounded research and summaries) and keep the advanced model for scoring and planning.", rationale: `${over.length} recent runs used a model above the route, which costs more for the same schema.`, evidenceIds: over.map((e) => e.id) });
    const low = feedback.filter((f) => f.agentId === a && f.rating <= 2).slice(-3);
    if (low.length)
      out.push({ agentId: a, kind: "prompt", title: "Address Khaneil's feedback", change: low.map((f) => `"${f.note.slice(0, 200)}"`).join(" "), rationale: `${low.length} low rating${low.length > 1 ? "s" : ""} from Khaneil.`, evidenceIds: low.map((f) => f.id) });
  }
  return out;
}
