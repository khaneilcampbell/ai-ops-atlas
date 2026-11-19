import type { HandoffRecord, OutputValue, RunLedger, StepOutput } from "../execution/types";
import type { ContextRecord, Evaluation } from "../intelligence/types";
import type { StoredTask, TaskArtifact } from "../tasks/types";
import type { WorkflowNode, WorkflowRun } from "../workflows/types";
import type { AgentOutput, OutputArtifact, OutputCategory, OutputIntel, OutputType, TableData } from "./types";
import { dedupe, parseScores, safeImageUrl, safeUrl } from "./validate";

// Live outputs, derived only from the run's real records: its Task Center tasks (attempts,
// approvals, artifacts, reported usage), the execution ledger's handoffs (outputs that passed the
// step's schema) and agent intelligence (context, evaluation). Nothing is invented: a step with
// no record shows no output, or says why. Ids are deterministic, so re-reading the same records
// after a repeated event gives the same cards, never extra ones.

/** Which toolbar group a step's outputs belong to. Failures always go to Errors. */
export const NODE_CATEGORY: Record<string, OutputCategory> = {
  intake: "decisions",
  "market-research": "research",
  "customer-research": "research",
  "competitor-analysis": "research",
  scoring: "analytics",
  viability: "decisions",
  parked: "decisions",
  brief: "documents",
  planning: "documents",
  "approve-scope": "decisions",
  develop: "engineering",
  quality: "engineering",
  "approve-launch": "decisions",
  publish: "documents",
  monitor: "analytics",
  launched: "analytics",
};
const categoryOf = (n: WorkflowNode): OutputCategory => NODE_CATEGORY[n.id] ?? (n.kind === "decision" || n.kind === "approval" ? "decisions" : "research");

/** The step's output fields, in words. */
const words = (k: string) => k.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (c) => c.toUpperCase());
const fmt = (v: OutputValue) => (Array.isArray(v) ? v.join(", ") : typeof v === "boolean" ? (v ? "Yes" : "No") : String(v));

function fieldsMarkdown(fields: Record<string, OutputValue>): string {
  return Object.entries(fields)
    .map(([k, v]) => (Array.isArray(v) ? `### ${words(k)}\n${v.map((x) => `- ${x}`).join("\n")}` : `**${words(k)}:** ${fmt(v)}`))
    .join("\n\n");
}

const listTable = (title: string, items: readonly string[]): TableData => ({ columns: ["#", title], rows: items.map((x, i) => [i + 1, x]) });

interface Base {
  run: WorkflowRun;
  node: WorkflowNode;
  task: StoredTask;
}

function base({ run, node, task }: Base, attempt: number | null, latest: boolean, at: string) {
  return { workflowRunId: run.id, taskId: task.id, agentId: node.agentId ?? task.agentId ?? "khaneil", nodeId: node.id, createdAt: at, mode: "live" as const, attempt, latest, category: categoryOf(node) };
}

function artifactOf(a: { id: string; label: string; url: string; kind: string }): OutputArtifact | null {
  const url = safeUrl(a.url);
  return url ? { id: a.id, label: a.label, url, kind: a.kind } : null;
}

/** The handoff's fields as one or more cards, shaped by the step. */
function handoffOutputs(b: Base, h: HandoffRecord, out: StepOutput, verified: boolean, latest: boolean): AgentOutput[] {
  const v = verified ? "verified" : "unverified";
  const common = { ...base(b, h.attempt, latest, h.at), verificationStatus: v as "verified" | "unverified", state: (b.task.status === "completed" ? "complete" : "partial") as "complete" | "partial", sourceRefs: out.artifacts.map((a) => a.url).filter((u) => safeUrl(u)).slice(0, 20) };
  const id = (k: string) => `${b.run.id}:${b.node.id}:${h.attempt}:${k}`;
  const f = out.fields;
  const res: AgentOutput[] = [];
  const add = (k: string, type: OutputType, title: string, data: unknown, summary?: string) => res.push({ ...common, id: id(k), type, title, structuredData: data, summary });

  const firstList = Object.entries(f).find(([, x]) => Array.isArray(x)) as [string, string[]] | undefined;
  switch (b.node.id) {
    case "scoring": {
      const rankings = Array.isArray(f.rankings) ? f.rankings : [];
      const chart = parseScores(rankings);
      if (chart) add("chart", "chart", "Opportunity scorecard", chart, typeof f.topIdea === "string" ? `Top idea: ${f.topIdea}` : undefined);
      add("table", "table", "Ranked opportunities", listTable("Idea and score", rankings), typeof f.topIdea === "string" ? `Top idea: ${f.topIdea}` : undefined);
      add("findings", "markdown", "Scoring rationale", fieldsMarkdown({ criteria: f.criteria ?? [], ...(typeof f.topIdea === "string" ? { topIdea: f.topIdea } : {}) }));
      break;
    }
    case "brief":
    case "planning":
      add("doc", "document", b.node.id === "brief" ? "Product brief" : "Development plan", { sections: Object.entries(f).map(([k, x]) => ({ heading: words(k), body: Array.isArray(x) ? x.map((i) => `- ${i}`).join("\n") : fmt(x) })) });
      break;
    case "develop":
    case "quality":
      add(
        "checks",
        "table",
        b.node.id === "quality" ? "Quality check results" : "Build and test results",
        { columns: ["Check", "Result"], rows: Object.entries(f).map(([k, x]) => [words(k), fmt(x)]) },
        b.node.id === "quality" && typeof f.passed === "boolean" ? (f.passed ? "All checks passed" : "Checks failed") : undefined,
      );
      break;
    case "viability":
    case "approve-scope":
    case "approve-launch":
      add("decision", "text", b.node.title, { text: Object.entries(f).map(([k, x]) => `${words(k)}: ${k === "branch" ? (x === "yes" ? "Go ahead" : "Park the idea") : fmt(x)}`).join("\n") });
      break;
    default:
      add("findings", "markdown", `${b.node.title} findings`, fieldsMarkdown(f), firstList ? `${firstList[1].length} ${words(firstList[0]).toLowerCase()}` : undefined);
      if (firstList && firstList[1].length > 1) add("table", "table", words(firstList[0]), listTable(words(firstList[0]).replace(/s$/, ""), firstList[1]));
  }
  for (const a of out.artifacts) {
    const art = artifactOf(a);
    if (!art) continue;
    const type: OutputType = safeImageUrl(art.url) ? "image" : a.kind === "document" || a.kind === "sheet" ? "document" : "link";
    res.push({ ...common, id: id(`artifact:${a.id}`), type, title: art.label, artifactRef: art.id, artifact: art, structuredData: undefined, category: a.kind === "github_run" || a.kind === "pull_request" ? "engineering" : common.category });
  }
  return res;
}

function intelFor(task: StoredTask, contexts: readonly ContextRecord[], evals: readonly Evaluation[]): OutputIntel | undefined {
  const ctx = contexts.filter((c) => c.taskId === task.id).pop();
  const ev = evals.filter((e) => e.taskId === task.id).pop();
  const usage = task.usage;
  const i: OutputIntel = {};
  const reported = usage.map((u) => u.model).filter(Boolean);
  if (reported.length) i.model = reported[reported.length - 1];
  else if (ctx?.route.model) i.model = ctx.route.model;
  if (ctx) {
    i.tier = ctx.route.tier;
    i.memory = ctx.items.map((m) => `${m.title} (${m.verification})`);
    i.tools = ctx.capabilities;
  }
  if (usage.length) {
    const tokens = usage.reduce((s, u) => s + (u.totalTokens ?? (u.inputTokens ?? 0) + (u.outputTokens ?? 0)), 0);
    if (tokens) i.tokens = tokens;
    const est = usage.filter((u) => u.cost?.basis === "estimated").reduce((s, u) => s + u.cost!.usd, 0);
    const billed = usage.filter((u) => u.cost?.basis === "billed").reduce((s, u) => s + u.cost!.usd, 0);
    if (usage.some((u) => u.cost?.basis === "estimated")) i.estimatedUsd = est;
    if (usage.some((u) => u.cost?.basis === "billed")) i.billedUsd = billed;
  }
  if (ev) {
    i.score = ev.score;
    i.flags = ev.flags;
    if (ev.human) i.feedback = { rating: ev.human.rating, note: ev.human.note, by: ev.human.by };
  }
  return Object.keys(i).length ? i : undefined;
}

const SYSTEM_ARTIFACTS = new Set<TaskArtifact["kind"]>(["github_run", "n8n_execution", "pull_request"]);
const TERMINAL = new Set(["completed", "failed", "cancelled"]);

export interface LiveInput {
  run: WorkflowRun;
  tasks: ReadonlyMap<string, StoredTask>;
  ledger?: RunLedger;
  contexts?: readonly ContextRecord[];
  evaluations?: readonly Evaluation[];
}

/** Every output of one live run, latest attempt first per step, from its records only. */
export function liveOutputs({ run, tasks, ledger, contexts = [], evaluations = [] }: LiveInput): AgentOutput[] {
  const res: AgentOutput[] = [];
  for (const node of run.snapshot.nodes) {
    if (node.kind === "outcome") continue;
    const taskId = run.nodeTasks[node.id];
    const fake = { id: taskId ?? `none:${node.id}`, agentId: node.agentId } as StoredTask;
    const err = (k: string, title: string, message: string, state: AgentOutput["state"]) =>
      res.push({ ...base({ run, node, task: fake }, null, true, run.createdAt), id: `${run.id}:${node.id}:${k}`, type: "error", title, structuredData: { message }, verificationStatus: "unverified", state, category: "errors" });

    if (!taskId) {
      if (run.errors[node.id]) err("no-task", `${node.title}: no task`, run.errors[node.id], "failed");
      continue;
    }
    const task = tasks.get(taskId);
    if (!task) {
      err("missing", `${node.title}: record missing`, "The Task Center task for this step isn't on this device, so its outputs can't be shown.", "missing");
      continue;
    }
    const b: Base = { run, node, task };
    const intel = intelFor(task, contexts.filter((c) => !c.runId || c.runId === run.id), evaluations.filter((e) => !e.runId || e.runId === run.id));
    const start = res.length;
    const lastNo = task.attempts.length ? task.attempts[task.attempts.length - 1].number : 0;
    const h = ledger?.handoffs[node.id];

    if (h && h.taskId === task.id) {
      const latest = h.attempt >= lastNo;
      if (h.state === "waived") res.push({ ...base(b, h.attempt, latest, h.at), id: `${run.id}:${node.id}:${h.attempt}:waived`, type: "text", title: `${node.title}: waived`, structuredData: { text: `Waived by ${h.by}${h.reason ? `: ${h.reason}` : "."} No output was produced.` }, verificationStatus: "unverified", state: "missing" });
      else if (h.output) res.push(...handoffOutputs(b, h, h.output, h.state === "validated" && task.status === "completed" && latest, latest));
      else res.push({ ...base(b, h.attempt, latest, h.at), id: `${run.id}:${node.id}:${h.attempt}:unverified`, type: "text", title: `${node.title}: no structured output`, structuredData: { text: `Completed without a structured output${h.reason ? ` (${h.reason})` : ""}. Nothing here is verified.` }, verificationStatus: "unverified", state: "complete" });
    } else if (task.status === "running" || task.status === "queued") {
      const live = task.attempts[task.attempts.length - 1];
      if (live && (live.state === "requested" || live.state === "running" || live.state === "unknown"))
        res.push({ ...base(b, live.number, true, live.startedAt ?? live.requestedAt), id: `${run.id}:${node.id}:${live.number}:pending`, type: "text", title: `${node.title}: in progress`, structuredData: { text: live.state === "unknown" ? "Atlas lost track of this attempt; a person has to check the outside system before anything is shown." : `Attempt ${live.number} is out with ${live.executor}. Outputs appear here when it reports back.` }, verificationStatus: "unverified", state: task.result !== undefined ? "partial" : "loading" });
    } else if (task.status === "completed" && node.kind !== "approval") {
      res.push({ ...base(b, lastNo || null, true, task.completedAt ?? task.updatedAt), id: `${run.id}:${node.id}:${lastNo}:unverified`, type: "text", title: `${node.title}: no structured output`, structuredData: { text: "Completed in the Task Center without a structured output. Nothing here is verified." }, verificationStatus: "unverified", state: "complete" });
    }
    if (node.unconfigured && task.status !== "completed" && !h)
      res.push({ ...base(b, null, true, task.createdAt), id: `${run.id}:${node.id}:unconfigured`, type: "text", title: `${node.title}: not set up`, structuredData: { text: node.unconfigured }, verificationStatus: "unverified", state: "unconfigured" });

    // Approvals and decisions a person recorded in the Task Center.
    for (const a of task.approvals)
      if (a.decision !== "requested")
        res.push({ ...base(b, a.forAttempt, a.forAttempt >= lastNo, a.at), id: `${run.id}:${node.id}:approval:${a.id}`, type: "text", title: `${a.decision === "granted" ? "Approved" : "Rejected"}: ${node.title}`, structuredData: { text: `${a.decision === "granted" ? "Approved" : "Rejected"} by ${a.actor.name}${a.reason ? `: ${a.reason}` : "."}` }, verificationStatus: "verified", state: "complete", category: "decisions" });

    // Failed attempts, kept apart from successful output. Earlier ones stay as history.
    for (const at of task.attempts)
      if (at.state === "failed")
        res.push({ ...base(b, at.number, at.number === lastNo, at.finishedAt ?? at.requestedAt), id: `${run.id}:${node.id}:${at.number}:failed`, type: "error", title: `${node.title}: attempt ${at.number} failed`, structuredData: { message: at.error ?? task.error ?? "Failed without an error message.", attempt: at.number }, verificationStatus: "unverified", state: "failed", category: "errors" });

    // Links the executing system recorded: run pages, pull requests. A person's link stays unverified.
    const handedOver = new Set(h?.output?.artifacts.map((a) => a.url) ?? []);
    for (const a of task.artifacts) {
      if (handedOver.has(a.url)) continue;
      const art = artifactOf(a);
      if (art) res.push({ ...base(b, null, true, a.at), id: `${run.id}:${node.id}:task-artifact:${a.id}`, type: safeImageUrl(art.url) ? "image" : "link", title: art.label, artifactRef: art.id, artifact: art, verificationStatus: SYSTEM_ARTIFACTS.has(a.kind) ? "verified" : "unverified", state: "complete", category: a.kind === "github_run" || a.kind === "pull_request" ? "engineering" : categoryOf(node) });
    }
    for (const at of task.attempts) {
      const art = at.externalUrl ? artifactOf({ id: `attempt-${at.number}`, label: `${at.executor === "github" ? "GitHub run" : at.executor === "n8n" ? "n8n execution" : "Run record"}, attempt ${at.number}`, url: at.externalUrl, kind: at.executor }) : null;
      if (art) res.push({ ...base(b, at.number, at.number === lastNo, at.startedAt ?? at.requestedAt), id: `${run.id}:${node.id}:${at.number}:run-link`, type: "link", title: art.label, artifactRef: art.id, artifact: art, verificationStatus: "verified", state: "complete", category: "engineering" });
    }

    // The execution log: every attempt as recorded.
    if (task.attempts.length) {
      const done = TERMINAL.has(task.status);
      res.push({
        ...base(b, null, true, task.updatedAt),
        id: `${run.id}:${node.id}:log`,
        type: "table",
        title: `${node.title}: execution log`,
        summary: `${task.attempts.length} attempt${task.attempts.length === 1 ? "" : "s"} of ${task.maxAttempts}`,
        structuredData: { columns: ["Attempt", "State", "Runs on", "Requested", "Finished", "Error"], rows: task.attempts.map((a) => [a.number, a.state, a.executor, a.requestedAt, a.finishedAt ?? "—", a.error ?? ""]) },
        verificationStatus: done ? "verified" : "unverified",
        state: done ? "complete" : "partial",
        category: "engineering",
      });
    }
    if (intel) for (let i = start; i < res.length; i++) res[i] = { ...res[i], intel };
  }

  // The business outcome, only as a person recorded it, with its sources.
  if (ledger?.outcome) {
    const o = ledger.outcome;
    const node = run.snapshot.nodes.find((n) => n.id === "monitor");
    if (node) {
      const fake = { id: run.nodeTasks[node.id] ?? `none:${node.id}`, agentId: node.agentId } as StoredTask;
      res.push({
        ...base({ run, node, task: fake }, null, true, o.recordedAt),
        id: `${run.id}:outcome`,
        type: o.metrics.length ? "table" : "text",
        title: "Business outcome",
        summary: `${o.state === "achieved" ? "Achieved" : o.state === "not_achieved" ? "Not achieved" : "Too early to tell"} · recorded by ${o.recordedBy}`,
        structuredData: o.metrics.length ? { columns: ["Metric", "Value", "Source"], rows: o.metrics.map((m) => [m.name, m.value, m.source]) } : { text: o.note || "No note." },
        sourceRefs: o.metrics.map((m) => m.source),
        verificationStatus: "unverified",
        state: "complete",
        category: "analytics",
      });
    }
  }
  return dedupe(res);
}
