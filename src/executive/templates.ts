import { BENJAIRE_LAUNCH } from "../workflows/benjaireLaunch";
import type { WorkflowDefinition, WorkflowEdge, WorkflowNode } from "../workflows/types";

// Deterministic planning templates for the goals Khaneil asks for most. Each is matched by fixed
// keywords (no model) and expands into a Workflow Intelligence definition whose agents are existing
// Agent Registry entries. Agent Operations Lead coordinates every plan; it never invents a new agent.
// Steps no agent can run are recorded as manual or unconfigured, never given an invented owner.

export interface PlanTemplate {
  id: string;
  name: string;
  /** All of one group must match (each group is any-of). */
  match: string[][];
  /** The building the goal belongs to when Khaneil doesn't pick one. */
  projectId: string;
  build: (goalId: string) => WorkflowDefinition;
  /** Success criteria offered (Khaneil can edit). */
  criteria: string[];
}

const READ_NOTE = "Reads records Atlas already fetches (GitHub sync, Task Center, n8n runs). Changes nothing; the result is recorded in the Task Center.";

const intake = (summary: string): WorkflowNode => ({
  id: "intake",
  kind: "agent",
  stage: 1,
  title: "Coordinate the goal",
  summary,
  agentId: "agent-operations-lead",
  inputs: ["The goal, its criteria and constraints"],
  outputs: ["One Task Center task per step"],
  execution: { kind: "manual", note: "Atlas creates the tasks when Khaneil starts the plan. No model is called." },
});

const agent = (id: string, stage: number, agentId: string, title: string, summary: string, outputs: string[], inputs: string[] = ["The goal"], kind: WorkflowNode["execution"]["kind"] = "manual", note = READ_NOTE): WorkflowNode => ({
  id,
  kind: "agent",
  stage,
  title,
  summary,
  agentId,
  inputs,
  outputs,
  execution: { kind, note },
});

const edges = (pairs: [string, string, ("yes" | "no")?][]): WorkflowEdge[] => pairs.map(([from, to, branch], i) => ({ id: `e${i + 1}`, from, to, ...(branch ? { branch, label: branch === "yes" ? "Yes" : "No" } : {}) }));

const def = (id: string, name: string, nodes: WorkflowNode[], e: WorkflowEdge[]): WorkflowDefinition => ({ id, version: 1, name, updatedAt: "2026-11-17", nodes, edges: e });

const outcome = (id: string, stage: number, title: string, summary: string, buildingId: string): WorkflowNode => ({ id, kind: "outcome", stage, title, summary, buildingId, inputs: [], outputs: [], execution: { kind: "manual", note: "The end of the plan." } });

export const TEMPLATES: readonly PlanTemplate[] = [
  {
    id: "product-research",
    name: "Identify, validate and prepare a Benjaire product",
    match: [["product", "idea", "offer"], ["research", "validate", "identify", "find", "prepare", "profitable", "launch"]],
    projectId: "benjaire-site",
    // The existing Benjaire product workflow, reused as is (same node ids, so the n8n Step Runner
    // bridge and Output Studio work unchanged).
    build: () => BENJAIRE_LAUNCH,
    criteria: ["A scored shortlist from real research", "A product brief Khaneil approves or parks", "No build, price or listing without Khaneil's approval"],
  },
  {
    id: "repo-health",
    name: "Review repository health and critical technical work",
    match: [["repo", "repos", "repository", "repositories", "github", "technical", "ci"], ["health", "review", "critical", "status", "check"]],
    projectId: "ai-ops-atlas",
    build: (g) =>
      def(`exec-${g}-repo-health`, "Repository health review", [
        intake("Splits the review into read-only checks, one per registered engineering agent."),
        agent("repo-status", 2, "repo-intelligence", "Retrieve repository status", "Open PRs, failing default-branch runs and stale repositories from the GitHub sync.", ["Repository status table"]),
        agent("ci-health", 2, "atlas-ci", "Read build and CI health", "Latest default-branch build and test results.", ["CI results"]),
        agent("app-health", 2, "atlas-health-monitor", "Run available health checks", "Production health and recent alerts Atlas already records.", ["Health findings"]),
        { id: "confirmed", kind: "decision", stage: 3, title: "Any confirmed failures?", summary: "Khaneil decides from the findings whether there is critical work. Only confirmed failures count.", buildingId: "ai-ops-atlas", inputs: ["Status", "CI results", "Health findings"], outputs: ["Yes or no"], execution: { kind: "manual", note: "Recorded by Khaneil in the Task Center." } },
        outcome("healthy", 3, "No critical work", "Nothing confirmed; the findings are kept.", "ai-ops-atlas"),
        agent("report", 4, "atlas-release-manager", "Prioritized technical report", "Ranks the confirmed failures and names the registered agent for each fix.", ["Prioritized report", "Proposed Task Center tasks"], ["Confirmed failures"]),
        { id: "approve-changes", kind: "approval", stage: 5, title: "Approve repository changes", summary: "Nothing in a repository changes until Khaneil approves it.", buildingId: "ai-ops-atlas", inputs: ["Prioritized report"], outputs: ["Approved fixes"], execution: { kind: "manual", note: "Approved in the Task Center, per run." }, approval: { categories: ["repository_change"], reason: "Fixes change repositories." } },
        outcome("fixes-queued", 5, "Fixes queued", "Approved fixes go to the Task Center as their own tasks and pull requests.", "ai-ops-atlas"),
      ], edges([["intake", "repo-status"], ["intake", "ci-health"], ["intake", "app-health"], ["repo-status", "confirmed"], ["ci-health", "confirmed"], ["app-health", "confirmed"], ["confirmed", "report", "yes"], ["confirmed", "healthy", "no"], ["report", "approve-changes"], ["approve-changes", "fixes-queued"]])),
    criteria: ["Every finding links to a run, PR or record", "Critical work ranked with an owner agent", "No repository change without approval"],
  },
  {
    id: "atlas-unfinished",
    name: "Identify unfinished Atlas development tasks",
    match: [["unfinished", "open", "backlog", "pending", "incomplete", "remaining"], ["atlas", "development", "dev", "tasks", "work"]],
    projectId: "ai-ops-atlas",
    build: (g) =>
      def(`exec-${g}-atlas-unfinished`, "Unfinished Atlas work", [
        intake("Collects open work from the repository and the Task Center."),
        agent("open-prs", 2, "repo-intelligence", "List open pull requests and issues", "Open, draft and stale pull requests in the Atlas repository.", ["Open work list"]),
        agent("open-tasks", 2, "agent-operations-lead", "List open Task Center work", "Queued, blocked and failed tasks across buildings.", ["Open task list"]),
        agent("rank", 3, "atlas-release-manager", "Rank what to finish next", "Orders the open work by risk and age. Recommendation only.", ["Ranked list"], ["Open work list", "Open task list"]),
        outcome("ranked", 3, "Ranked list ready", "Khaneil picks what to finish.", "ai-ops-atlas"),
      ], edges([["intake", "open-prs"], ["intake", "open-tasks"], ["open-prs", "rank"], ["open-tasks", "rank"], ["rank", "ranked"]])),
    criteria: ["Every item links to a PR, issue or task", "Nothing is closed or merged by Atlas"],
  },
  {
    id: "failed-automation",
    name: "Investigate a failed automation",
    match: [["failed", "failure", "broken", "error", "errors", "investigate"], ["automation", "workflow", "n8n", "run", "job", "flow"]],
    projectId: "benjaire-site",
    build: (g) =>
      def(`exec-${g}-failed-automation`, "Failed automation investigation", [
        intake("Opens the investigation and links the failed run."),
        agent("collect", 2, "benjaire-ops-monitor", "Collect the failure records", "Failure and missed-run alerts plus the run's error, from records Atlas already has.", ["Failure record"], ["The failed run"], "owned", "Works through the automations it owns (Benjaire Ops · Workflow Failure Alerts, Benjaire Ops · Missed Run Check). Atlas reads their results."),
        agent("cause", 3, "agent-operations-lead", "Find the likely cause", "Matches the error against operational memory and the run history. Says when the cause is unknown.", ["Likely cause with sources"], ["Failure record"]),
        { id: "approve-recovery", kind: "approval", stage: 4, title: "Approve recovery", summary: "A re-run or fix changes infrastructure, so Khaneil approves it first.", buildingId: "ai-ops-atlas", inputs: ["Likely cause"], outputs: ["Approved recovery"], execution: { kind: "manual", note: "Approved in the Task Center." }, approval: { categories: ["infrastructure"], reason: "Recovery re-runs or changes a live automation." } },
        agent("recover", 5, "atlas-rerun-failed", "Run the authorised recovery", "Re-runs the failed jobs through the existing write action.", ["Re-run link"], ["Approved recovery"], "github", "The existing re-run-failed-jobs action in the Mac app, with Touch ID. Atlas never re-runs on its own."),
        outcome("recovered", 5, "Recovery recorded", "The re-run result is linked on the task.", "ai-ops-atlas"),
      ], edges([["intake", "collect"], ["collect", "cause"], ["cause", "approve-recovery"], ["approve-recovery", "recover"], ["recover", "recovered"]])),
    criteria: ["The failure's cause is linked to evidence or marked unknown", "Recovery only after approval"],
  },
  {
    id: "business-priorities",
    name: "Summarize current business priorities",
    match: [["priorities", "priority", "focus"], ["business", "benjaire", "current", "summarize", "summarise"]],
    projectId: "benjaire-site",
    build: (g) =>
      def(`exec-${g}-business-priorities`, "Business priorities summary", [
        intake("Gathers business goals, open work and operations health."),
        agent("ops", 2, "benjaire-ops-monitor", "Operations health", "Failing or silent workflows and open alerts.", ["Operations health"], ["The goal"], "owned", "Works through the automations it owns. Atlas reads their results."),
        agent("summary", 3, "agent-operations-lead", "Write the priorities summary", "Business goals at risk, pending decisions and open work, from Atlas records. No model unless Khaneil asks.", ["Priorities summary"], ["Operations health", "Business goals"]),
        outcome("summarized", 3, "Summary ready", "Khaneil reviews it.", "benjaire-site"),
      ], edges([["intake", "ops"], ["ops", "summary"], ["summary", "summarized"]])),
    criteria: ["Every priority links to a goal, task or alert"],
  },
  {
    id: "operational-briefing",
    name: "Prepare an operational briefing",
    match: [["briefing", "brief", "digest", "review", "report"], ["weekly", "daily", "operational", "operations", "week"]],
    projectId: "project-intelligence-hub",
    build: (g) =>
      def(`exec-${g}-briefing`, "Operational briefing", [
        intake("Builds the briefing from Atlas records."),
        agent("aggregate", 2, "agent-operations-lead", "Aggregate the records", "Counts goals, tasks, approvals, failures and AI cost. Deterministic, no model.", ["Briefing"]),
        outcome("briefed", 2, "Briefing ready", "Shown in Mission Control.", "project-intelligence-hub"),
      ], edges([["intake", "aggregate"], ["aggregate", "briefed"]])),
    criteria: ["Every number comes from an Atlas record"],
  },
  {
    id: "implementation-plan",
    name: "Create an implementation plan for a project",
    match: [["implementation", "implement", "build"], ["plan", "planning", "roadmap", "scope"]],
    projectId: "ai-ops-atlas",
    build: (g) =>
      def(`exec-${g}-implementation-plan`, "Implementation plan", [
        intake("Collects what exists before planning."),
        agent("context", 2, "repo-intelligence", "Read the project's current state", "Repository structure, open PRs and recent failures.", ["Current state notes"]),
        agent("docs", 2, "documentation-lead", "Read existing docs", "The project's docs and their freshness.", ["Docs summary"], ["The goal"], "owned", "Works through the automations it owns (docs render and check)."),
        { ...agent("draft", 3, "agent-operations-lead", "Draft the plan", "Phases, owners and risks using registered agents only.", ["Implementation plan"], ["Current state notes", "Docs summary"]), caveat: "Writing a plan is reasoning work: Khaneil writes it, or asks the model router for a draft (Tier 2, his call)." },
        { id: "approve-plan", kind: "approval", stage: 4, title: "Approve before any change", summary: "No repository changes until Khaneil approves the plan.", buildingId: "ai-ops-atlas", inputs: ["Implementation plan"], outputs: ["Approval"], execution: { kind: "manual", note: "Approved in the Task Center." }, approval: { categories: ["repository_change"], reason: "Implementing changes repositories." } },
        outcome("planned", 4, "Plan approved", "Implementation tasks go to the Task Center.", "ai-ops-atlas"),
      ], edges([["intake", "context"], ["intake", "docs"], ["context", "draft"], ["docs", "draft"], ["draft", "approve-plan"], ["approve-plan", "planned"]])),
    criteria: ["Plan names registered agents only", "No change before approval"],
  },
];

const words = (s: string) => new Set(s.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));

/** The best matching template, or null when none matches (then Khaneil picks one or plans by hand). */
export function matchTemplate(objective: string): { template: PlanTemplate; reason: string } | null {
  const w = words(objective);
  for (const t of TEMPLATES) {
    const hits = t.match.map((group) => group.find((k) => w.has(k)));
    if (hits.every(Boolean)) return { template: t, reason: `Matched the "${t.name}" template on: ${hits.join(", ")}.` };
  }
  return null;
}

export const templateById = (id: string) => TEMPLATES.find((t) => t.id === id);
