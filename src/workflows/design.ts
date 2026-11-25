import type { Catalog } from "../catalog/types";
import { agentProblem } from "../tasks/registry";
import { CATEGORY_LABEL } from "../tasks/types";
import { skippedBy } from "./engine";
import { topoOrder } from "./graph";
import type { WorkflowDefinition, WorkflowEdge, WorkflowNode } from "./types";

// Design mode: a draft of a workflow that Khaneil edits in Workflow Intelligence. A draft is a
// plain ordered list of steps (agent steps, human approval checkpoints and one completion step),
// keyed by the template's definition id so the workflow keeps its identity. It never replaces the
// saved template and never starts anything: Run mode keeps reading the template, and Preview only
// checks the draft and describes what would happen. Everything here is pure.

export const FAILURE_BEHAVIORS = ["pause", "retry", "stop"] as const;
export type FailureBehavior = (typeof FAILURE_BEHAVIORS)[number];
export const FAILURE_LABEL: Record<FailureBehavior, string> = { pause: "Pause for review", retry: "Retry once, then pause", stop: "Stop the workflow" };

/** An earlier step's output that this step receives. */
export interface Handoff {
  fromStepId: string;
  output: string;
}

export type DesignStepKind = "agent" | "approval" | "outcome";

export interface DesignStep extends WorkflowNode {
  kind: DesignStepKind;
  instructions: string;
  onFailure: FailureBehavior;
  /** Outputs of earlier steps this step receives. `inputs` holds anything else it gets (e.g. "The goal"). */
  handoffs: Handoff[];
}

export interface WorkflowDraft {
  status: "draft";
  /** The template it drafts. Same id, so it stays the same workflow. */
  definitionId: string;
  goalId: string;
  name: string;
  /** The template version the draft was started from. */
  baseVersion: number;
  /** Bumped on every save; 0 until the first save. */
  revision: number;
  savedAt: string | null;
  steps: DesignStep[];
}

export interface DraftProblem {
  stepId?: string;
  text: string;
}

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

/**
 * A first draft from a saved template. Drafts are sequential, so the template is read in run order
 * along the "go ahead" path of each decision: decisions become approval checkpoints, automations
 * become agent steps and steps only on a "no" branch are left out. `notes` says what changed.
 */
export function draftFromDefinition(def: WorkflowDefinition, goalId: string): { draft: WorkflowDraft; notes: string[] } {
  const notes: string[] = [];
  const decisions = def.nodes.filter((n) => n.kind === "decision");
  const skipped = skippedBy(def, Object.fromEntries(decisions.map((n) => [n.id, "yes" as const])));
  const order = (topoOrder(def) ?? def.nodes.map((n) => n.id)).filter((id) => !skipped.has(id));
  const byId = new Map(def.nodes.map((n) => [n.id, n]));
  const outcomes = order.filter((id) => byId.get(id)!.kind === "outcome");
  const work = order.filter((id) => byId.get(id)!.kind !== "outcome");
  const steps: DesignStep[] = work.map((id) => {
    const n = clone(byId.get(id)!);
    const kind: DesignStepKind = n.kind === "approval" || n.kind === "decision" ? "approval" : "agent";
    const step: DesignStep = { ...n, kind, instructions: n.summary, onFailure: "pause", handoffs: [] };
    if (kind === "approval") {
      delete step.agentId;
      step.approval = step.approval ?? { categories: [], reason: n.kind === "decision" ? "Khaneil decides whether to go ahead. In a draft, a no stops the workflow here." : "" };
    }
    return step;
  });
  // Handoffs: an input that names an earlier step's output is linked to the nearest such step. The
  // template words them a little differently ("Personas" for "Personas and buyer pains"), so an
  // exact name wins, else an output that contains the input's words.
  for (let i = 0; i < steps.length; i++) {
    const keep: string[] = [];
    for (const input of steps[i].inputs) {
      const h = earlierOutput(steps.slice(0, i), input);
      if (h) steps[i].handoffs.push(h);
      else keep.push(input);
    }
    steps[i].inputs = keep;
  }
  const last = outcomes.length ? clone(byId.get(outcomes[outcomes.length - 1])!) : null;
  steps.push(
    last
      ? { ...last, kind: "outcome", instructions: last.summary, onFailure: "stop", handoffs: [] }
      : {
          id: uniqueId(steps, "complete"),
          kind: "outcome",
          stage: steps.length + 1,
          title: "Goal complete",
          summary: "The workflow ends here.",
          inputs: [],
          outputs: [],
          execution: { kind: "manual", note: "The end of the workflow." },
          instructions: "",
          onFailure: "stop",
          handoffs: [],
        },
  );
  if (!last) notes.push("The template has no completion step, so the draft adds one.");
  if (decisions.length) notes.push(`Drafts are sequential: ${decisions.map((d) => `"${d.title}"`).join(", ")} became an approval checkpoint, and a no stops the workflow there.`);
  if (skipped.size) notes.push(`Left out because they only follow a "no" answer: ${[...skipped].map((id) => byId.get(id)!.title).join(", ")}.`);
  if (def.edges.some((e) => def.edges.some((f) => f !== e && f.from === e.from && !e.branch && !f.branch))) notes.push("Steps the template runs side by side are listed one after another.");
  const draft: WorkflowDraft = { status: "draft", definitionId: def.id, goalId, name: def.name, baseVersion: def.version, revision: 0, savedAt: null, steps };
  return { draft, notes };
}

const words = (s: string) => s.trim().toLowerCase();

function earlierOutput(earlier: readonly DesignStep[], input: string): Handoff | null {
  const want = words(input);
  const contains = (o: string) => new RegExp(`(^|\\W)${want.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\W|$)`).test(words(o));
  for (const match of [(o: string) => words(o) === want, contains]) {
    const from = [...earlier].reverse().find((s) => s.outputs.some(match));
    if (from) return { fromStepId: from.id, output: from.outputs.find(match)! };
  }
  return null;
}

/** A new id that no step uses, e.g. `step-3`. Ids never change once given. */
export function uniqueId(steps: readonly Pick<DesignStep, "id">[], prefix: string): string {
  const used = new Set(steps.map((s) => s.id));
  if (!used.has(prefix) && prefix === "complete") return prefix;
  for (let i = 1; ; i++) if (!used.has(`${prefix}-${i}`)) return `${prefix}-${i}`;
}

// ---------------------------------------------------------------------------------------------
// Edits. Each returns a new draft and leaves the old one untouched. Nothing is fixed up silently:
// a handoff that an edit breaks stays in the draft and validation names it.

const withSteps = (d: WorkflowDraft, steps: DesignStep[]): WorkflowDraft => ({ ...d, steps: steps.map((s, i) => ({ ...s, stage: i + 1 })) });

/** Adds a step after `afterId` (or before the completion step). Returns the draft and the new id. */
export function addStep(d: WorkflowDraft, kind: "agent" | "approval", afterId: string | null): { draft: WorkflowDraft; id: string } {
  const id = uniqueId(d.steps, kind === "agent" ? "step" : "approval");
  const step: DesignStep =
    kind === "agent"
      ? {
          id,
          kind,
          stage: 0,
          title: "New agent step",
          summary: "",
          inputs: [],
          outputs: [],
          instructions: "",
          onFailure: "pause",
          handoffs: [],
          execution: { kind: "owned", note: "Done by the assigned agent." },
        }
      : {
          id,
          kind,
          stage: 0,
          title: "Khaneil approves",
          summary: "",
          inputs: [],
          outputs: [],
          instructions: "",
          onFailure: "pause",
          handoffs: [],
          execution: { kind: "manual", note: "Approved in the Task Center. Only a person can approve." },
          approval: { categories: [], reason: "" },
        };
  const end = d.steps.findIndex((s) => s.kind === "outcome");
  let at = afterId ? d.steps.findIndex((s) => s.id === afterId) + 1 : end === -1 ? d.steps.length : end;
  if (end !== -1 && at > end) at = end;
  const steps = [...d.steps];
  steps.splice(Math.max(0, at), 0, step);
  return { draft: withSteps(d, steps), id };
}

export function updateStep(d: WorkflowDraft, id: string, patch: Partial<Omit<DesignStep, "id" | "kind">>): WorkflowDraft {
  return withSteps(
    d,
    d.steps.map((s) => (s.id === id ? { ...s, ...patch, id: s.id, kind: s.kind } : s)),
  );
}

/** Removes a step. The completion step stays. Handoffs from it stay, so validation shows them. */
export function removeStep(d: WorkflowDraft, id: string): WorkflowDraft {
  if (d.steps.find((s) => s.id === id)?.kind === "outcome") return d;
  return withSteps(
    d,
    d.steps.filter((s) => s.id !== id),
  );
}

/** Moves a step one place earlier (-1) or later (+1). It never moves past the completion step. */
export function moveStep(d: WorkflowDraft, id: string, delta: -1 | 1): WorkflowDraft {
  const i = d.steps.findIndex((s) => s.id === id);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= d.steps.length || d.steps[i].kind === "outcome" || d.steps[j].kind === "outcome") return d;
  const steps = [...d.steps];
  [steps[i], steps[j]] = [steps[j], steps[i]];
  return withSteps(d, steps);
}

/** Turns one earlier output on or off as an input of `id`. */
export function toggleHandoff(d: WorkflowDraft, id: string, h: Handoff): WorkflowDraft {
  const step = d.steps.find((s) => s.id === id);
  if (!step) return d;
  const has = step.handoffs.some((x) => x.fromStepId === h.fromStepId && x.output === h.output);
  return updateStep(d, id, { handoffs: has ? step.handoffs.filter((x) => !(x.fromStepId === h.fromStepId && x.output === h.output)) : [...step.handoffs, h] });
}

/** Earlier outputs a step can receive, in step order. */
export function availableOutputs(d: WorkflowDraft, id: string): Handoff[] {
  const i = d.steps.findIndex((s) => s.id === id);
  return d.steps.slice(0, Math.max(0, i)).flatMap((s) => s.outputs.filter((o) => o.trim()).map((output) => ({ fromStepId: s.id, output })));
}

// ---------------------------------------------------------------------------------------------
// Validation

const ID_RE = /^[a-z0-9][a-z0-9-]*$/;

export function draftProblems(d: WorkflowDraft, c: Catalog): DraftProblem[] {
  const out: DraftProblem[] = [];
  const steps = d.steps;
  if (!steps.length) return [{ text: "The workflow has no steps." }];
  const seen = new Set<string>();
  for (const s of steps) {
    if (!ID_RE.test(s.id)) out.push({ stepId: s.id, text: `Step id "${s.id}" isn't a stable id (lowercase letters, numbers and dashes).` });
    if (seen.has(s.id)) out.push({ stepId: s.id, text: `Two steps share the id "${s.id}".` });
    seen.add(s.id);
  }
  const work = steps.filter((s) => s.kind !== "outcome");
  const outcomes = steps.filter((s) => s.kind === "outcome");
  if (!steps.some((s) => s.kind === "agent")) out.push({ text: "The workflow needs at least one agent step." });
  if (steps[0].kind !== "agent") out.push({ stepId: steps[0].id, text: "The workflow must start with an agent step." });
  if (outcomes.length !== 1 || steps[steps.length - 1].kind !== "outcome") out.push({ text: "The workflow needs one completion step, at the end." });
  if (work.length && work[work.length - 1].kind === "approval")
    out.push({ stepId: work[work.length - 1].id, text: "An approval just before completion has nothing left to approve. Add a step after it or remove it." });

  const index = new Map(steps.map((s, i) => [s.id, i]));
  steps.forEach((s, i) => {
    const p = (text: string) => out.push({ stepId: s.id, text });
    if (!s.title.trim()) p("Give this step a name.");
    if (s.kind === "agent") {
      if (!s.agentId) p(`${s.title || "This step"} needs an agent.`);
      else {
        const why = agentProblem(c.agents.find((a) => a.id === s.agentId));
        if (why) p(why);
      }
      if (!s.instructions.trim()) p(`Say what ${s.title || "this step"} should do.`);
      if (!s.outputs.some((o) => o.trim())) p(`Say what ${s.title || "this step"} produces.`);
    }
    if (s.kind === "approval" && s.agentId) p("Approvals are made by Khaneil, not an agent.");
    if (i > 0 && steps[i - 1].kind === "approval" && s.kind === "approval") p("Two approvals in a row: merge them into one.");
    for (const h of s.handoffs) {
      const j = index.get(h.fromStepId);
      const from = j === undefined ? undefined : steps[j];
      if (!from) p(`Receives "${h.output}" from a step that isn't in the workflow any more.`);
      else if (j! >= i) p(`Receives "${h.output}" from ${from.title}, which comes later.`);
      else if (!from.outputs.includes(h.output)) p(`${from.title} doesn't produce "${h.output}" any more.`);
    }
  });
  return out;
}

// ---------------------------------------------------------------------------------------------
// Drawing and preview

/** The draft as a definition for the canvas: one edge between each step and the next, labelled with how many handoffs reach the next step over it. */
export function draftDefinition(d: WorkflowDraft): WorkflowDefinition {
  const edges: WorkflowEdge[] = [];
  const at = new Map(d.steps.map((s, i) => [s.id, i]));
  for (let i = 1; i < d.steps.length; i++) {
    const to = d.steps[i];
    const crossing = to.handoffs.filter((h) => (at.get(h.fromStepId) ?? -1) >= 0 && at.get(h.fromStepId)! < i).map((h) => h.output);
    edges.push({ id: `handoff:${to.id}`, from: d.steps[i - 1].id, to: to.id, ...(crossing.length ? { label: `${crossing.length} handoff${crossing.length === 1 ? "" : "s"}` } : {}) });
  }
  return { id: d.definitionId, version: d.baseVersion, name: `${d.name} (draft)`, updatedAt: d.savedAt ?? "", nodes: d.steps, edges };
}

export interface PreviewLine {
  stepId: string;
  title: string;
  text: string;
}

export interface Preview {
  ready: boolean;
  problems: DraftProblem[];
  lines: PreviewLine[];
}

/**
 * What would happen, step by step. Read from the draft and the catalog only: nothing is called,
 * started or saved. `ready` is false whenever validation finds a problem.
 */
export function previewDraft(d: WorkflowDraft, c: Catalog): Preview {
  const problems = draftProblems(d, c);
  const title = (id: string) => d.steps.find((s) => s.id === id)?.title ?? "a removed step";
  const lines = d.steps.map((s, i): PreviewLine => {
    const n = `${i + 1}.`;
    if (s.kind === "approval") {
      const cats = s.approval?.categories.length ? ` (${s.approval.categories.map((x) => CATEGORY_LABEL[x]).join(", ")})` : "";
      const reviews = s.handoffs.length ? ` Khaneil reviews ${s.handoffs.map((h) => `${h.output} (from ${title(h.fromStepId)})`).join("; ")}.` : "";
      return { stepId: s.id, title: s.title, text: `${n} Waits for Khaneil to approve${cats}.${reviews} Nothing after it starts until Khaneil approves; a rejection stops the workflow.` };
    }
    if (s.kind === "outcome") return { stepId: s.id, title: s.title, text: `${n} The workflow completes: ${s.title}.` };
    const agent = c.agents.find((a) => a.id === s.agentId);
    const who = agent ? (agent.registry?.title ?? agent.name) : "No agent assigned";
    const gets = [...s.inputs.filter((x) => x.trim()), ...s.handoffs.map((h) => `${h.output} (from ${title(h.fromStepId)})`)];
    return {
      stepId: s.id,
      title: s.title,
      text: `${n} ${who} gets ${gets.length ? gets.join("; ") : "nothing from earlier steps"}, and produces ${s.outputs.filter((o) => o.trim()).join("; ") || "nothing yet"}. If it fails: ${FAILURE_LABEL[s.onFailure].toLowerCase()}.${s.approval?.categories.length ? " Khaneil approves this step before it runs." : ""}`,
    };
  });
  return { ready: problems.length === 0, problems, lines };
}

/** True when two drafts have the same steps (ignoring save details). */
export const sameSteps = (a: WorkflowDraft | null | undefined, b: WorkflowDraft | null | undefined) => !!a && !!b && JSON.stringify(a.steps) === JSON.stringify(b.steps);
