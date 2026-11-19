import { aiCost, type Period } from "../business/finance";
import type { Catalog } from "../catalog/types";
import type { StoredTask } from "../tasks/types";
import type { WorkflowRun } from "../workflows/types";
import { goalStatus } from "./coordinator";
import { executiveAttention, type ExecutiveSignal } from "./signals";
import { GOAL_STATE_LABEL, type ExecutiveGoal } from "./types";

// Executive briefings, aggregated deterministically from Atlas records: goals, Task Center tasks,
// workflow runs and reported model usage. No model is called and nothing is inferred: a count is
// a count of records, and an empty section says so. An AI-written synthesis is never produced here;
// Khaneil can ask for one separately.

export type BriefingKind = "on_demand" | "daily" | "weekly" | "project";

export const BRIEFING_LABEL: Record<BriefingKind, string> = { on_demand: "Right now", daily: "Daily summary", weekly: "Weekly review", project: "Project summary" };

export interface BriefingItem {
  text: string;
  /** Where the fact comes from: a goal, task or run id. */
  ref: string;
}

export interface Briefing {
  kind: BriefingKind;
  period: Period;
  projectId: string | null;
  generatedAt: string;
  inProgress: BriefingItem[];
  completedWork: BriefingItem[];
  outcomes: BriefingItem[];
  decisions: BriefingItem[];
  problems: BriefingItem[];
  milestones: BriefingItem[];
  ai: { usd: number; estimated: boolean; tasksWithUsage: number; completedTasks: number };
  nextActions: string[];
}

const DAY = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export function briefingPeriod(kind: BriefingKind, now: number): Period {
  const to = iso(now);
  return { from: kind === "weekly" ? iso(now - 6 * DAY) : kind === "daily" || kind === "on_demand" ? to : iso(now - 29 * DAY), to };
}

const inPeriod = (at: string | undefined, p: Period) => !!at && at.slice(0, 10) >= p.from && at.slice(0, 10) <= p.to;

export interface BriefingInput {
  kind: BriefingKind;
  goals: readonly ExecutiveGoal[];
  runs: readonly WorkflowRun[];
  tasks: readonly StoredTask[];
  catalog: Catalog;
  now: number;
  projectId?: string;
  dismissed?: ReadonlySet<string>;
}

export function buildBriefing(i: BriefingInput): Briefing {
  const period = briefingPeriod(i.kind, i.now);
  const projectId = i.kind === "project" ? (i.projectId ?? "") : null;
  const goals = projectId === null ? i.goals : i.goals.filter((g) => g.projectId === projectId);
  const byId = new Map(i.tasks.map((t) => [t.id, t]));
  const goalTaskIds = new Map<string, string>();
  for (const g of goals) for (const r of i.runs.filter((x) => g.runIds.includes(x.id))) for (const id of Object.values(r.nodeTasks)) goalTaskIds.set(id, g.id);
  const scopedTasks = projectId === null ? i.tasks : i.tasks.filter((t) => goalTaskIds.has(t.id) || t.buildingId === projectId);

  const inProgress: BriefingItem[] = [];
  const milestones: BriefingItem[] = [];
  for (const g of goals) {
    if (g.state === "completed" || g.state === "not_achieved" || g.state === "cancelled") continue;
    const s = goalStatus(g, i.runs, byId, i.catalog);
    inProgress.push({ text: `${g.objective}: ${GOAL_STATE_LABEL[g.state]}${s.progress !== null ? `, ${s.done} of ${s.total} steps done` : ""}`, ref: g.id });
    if (s.nextMilestone) milestones.push({ text: `${g.objective}: next is "${s.nextMilestone}"${g.deadline ? ` (deadline ${g.deadline})` : ""}`, ref: g.id });
    else if (g.deadline) milestones.push({ text: `${g.objective}: deadline ${g.deadline}`, ref: g.id });
  }

  const completedWork = scopedTasks
    .filter((t) => t.status === "completed" && inPeriod(t.completedAt, period))
    .sort((a, b) => (b.completedAt ?? "").localeCompare(a.completedAt ?? ""))
    .slice(0, 12)
    .map((t) => ({ text: `${t.title}${t.agentName ? ` (${t.agentName})` : ""}`, ref: t.id }));

  const outcomes = goals
    .filter((g) => (g.state === "completed" || g.state === "not_achieved") && inPeriod(g.updatedAt, period))
    .map((g) => ({ text: `${g.objective}: ${g.state === "completed" ? "achieved" : "not achieved"}. ${g.outcomeNote ?? ""}`.trim(), ref: g.id }));

  const decisions: BriefingItem[] = [
    ...goals.filter((g) => g.state === "planned").map((g) => ({ text: `Review the plan for "${g.objective}"`, ref: g.id })),
    ...goals.filter((g) => g.state === "review").map((g) => ({ text: `Judge the outcome of "${g.objective}"`, ref: g.id })),
    ...scopedTasks.filter((t) => t.status === "awaiting_approval").map((t) => ({ text: `Approve or reject "${t.title}"`, ref: t.id })),
  ];

  const signals: ExecutiveSignal[] = executiveAttention(goals, i.runs, byId, i.catalog, i.now, i.dismissed);
  const problems = [
    ...signals.filter((s) => s.kind !== "pending_approval" && s.severity !== "low").map((s) => ({ text: `${s.title}: ${s.detail}`, ref: s.taskId ?? s.goalId })),
    ...scopedTasks.filter((t) => t.status === "failed" && !goalTaskIds.has(t.id) && inPeriod(t.updatedAt, period)).map((t) => ({ text: `${t.title} failed`, ref: t.id })),
  ];

  const cost = aiCost(scopedTasks, period);
  const nextActions: string[] = [];
  if (decisions.length) nextActions.push(`Clear ${decisions.length} pending decision${decisions.length === 1 ? "" : "s"}, starting with: ${decisions[0].text}.`);
  const failed = signals.find((s) => s.kind === "failed");
  if (failed) nextActions.push(`Open the failed step "${failed.title.replace(/ failed$/, "")}" and retry or cancel it.`);
  const unavailable = signals.find((s) => s.kind === "unavailable_agent");
  if (unavailable) nextActions.push(`${unavailable.title}: switch it back on or change the plan.`);
  if (signals.some((s) => s.kind === "budget_exceeded")) nextActions.push("A goal used its budget: raise it or stop the remaining steps.");
  const draft = goals.find((g) => g.state === "draft");
  if (draft) nextActions.push(`Draft a plan for "${draft.objective}".`);
  const approved = goals.find((g) => g.state === "approved");
  if (approved) nextActions.push(`Start the approved plan for "${approved.objective}".`);

  return {
    kind: i.kind,
    period,
    projectId,
    generatedAt: new Date(i.now).toISOString(),
    inProgress,
    completedWork,
    outcomes,
    decisions,
    problems,
    milestones,
    ai: { usd: cost.usd, estimated: cost.estimated, tasksWithUsage: cost.tasks, completedTasks: cost.completedTasks },
    nextActions: nextActions.slice(0, 5),
  };
}

/** Plain text, for copying into a note. Every line is a record; empty sections say "None". */
export function briefingText(b: Briefing): string {
  const sec = (title: string, xs: BriefingItem[]) => [`${title}:`, ...(xs.length ? xs.map((x) => `- ${x.text}`) : ["- None"])].join("\n");
  return [
    `Atlas ${BRIEFING_LABEL[b.kind].toLowerCase()}, ${b.period.from === b.period.to ? b.period.from : `${b.period.from} to ${b.period.to}`}`,
    sec("Goals in progress", b.inProgress),
    sec("Completed work", b.completedWork),
    sec("Outcomes", b.outcomes),
    sec("Pending decisions", b.decisions),
    sec("Operational problems", b.problems),
    sec("Upcoming milestones", b.milestones),
    `AI usage: $${b.ai.usd.toFixed(2)}${b.ai.estimated ? " (includes estimates)" : ""} across ${b.ai.tasksWithUsage} task${b.ai.tasksWithUsage === 1 ? "" : "s"} with reported usage.`,
    ["Recommended next actions:", ...(b.nextActions.length ? b.nextActions.map((x) => `- ${x}`) : ["- Nothing needs you."])].join("\n"),
  ].join("\n\n");
}
