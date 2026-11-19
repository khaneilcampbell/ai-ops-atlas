import { districtOf } from "../catalog/organization";
import type { DistrictId } from "../catalog/taxonomy";
import type { Catalog, Project } from "../catalog/types";
import type { RunStatus } from "../execution/types";
import type { StoredTask } from "../tasks/types";
import { INTEGRATION_CATALOG } from "./integrations";
import { integrationsFor } from "./marketplace";
import { requiredAgents, TEMPLATES } from "./templates";
import { CATEGORIES, type Category, type Workspace } from "./workspace";

// Personal command center: how Atlas organizes one owner's businesses, projects and systems. It is
// a read-only view over records Atlas already keeps (catalog manifests, Task Center tasks, workflow
// runs, the Integration Center), with no store of its own:
//
//   Atlas → category → business → project (building) → repository → agent → workflow → task → artifact
//
// A building's category comes from its map district unless the owner moved it in the Workspace
// page (Workspace.categoryOverrides). Nothing here changes the map: districts, buildings and ids
// stay as they are.

export const CATEGORY_INFO: Record<Category, { label: string; description: string }> = {
  "business-operations": { label: "Business Operations", description: "Benjaire, digital products, commerce, customer inquiries, marketing and finance." },
  "ai-engineering": { label: "AI Engineering", description: "Atlas itself, AI agents, automation, development tools, repositories and experiments." },
  infrastructure: { label: "Infrastructure", description: "Hosting, n8n, Cloudflare, APIs, security and monitoring." },
  "personal-operations": { label: "Personal Operations", description: "Personal projects, research, career, productivity, goals and planning." },
};

/** Where each map district lands by default. Atlas (the command center) counts as AI engineering. */
export const DISTRICT_CATEGORY: Record<DistrictId, Category> = {
  "ai-operations": "ai-engineering",
  "business-operations": "business-operations",
  "ai-engineering": "ai-engineering",
  "security-infrastructure": "infrastructure",
  "career-portfolio": "personal-operations",
};

export function categoryOf(project: Project, catalog: Catalog, overrides: Readonly<Record<string, Category>> = {}): { category: Category; moved: boolean } {
  const own = overrides[project.id];
  if (own) return { category: own, moved: true };
  return { category: DISTRICT_CATEGORY[districtOf(project, catalog.agents).value], moved: false };
}

const OPEN: ReadonlySet<StoredTask["status"]> = new Set(["queued", "running", "blocked", "awaiting_approval"]);

export interface PortfolioProject {
  id: string;
  name: string;
  /** The organization the building's manifest names, or "Unassigned" when it names none (never guessed). */
  business: string;
  category: Category;
  moved: boolean;
  repositories: string[];
  agents: { id: string; name: string; status: string }[];
  /** Workflow templates that use one of this building's agents. */
  workflows: { id: string; name: string }[];
  openTasks: number;
  completedTasks: number;
  artifacts: number;
}

export interface PortfolioCategory {
  id: Category;
  label: string;
  description: string;
  businesses: { name: string; projects: PortfolioProject[] }[];
}

export interface Portfolio {
  categories: PortfolioCategory[];
  /** References that point at something Atlas doesn't have, in plain words. */
  problems: string[];
}

/** The owner's portfolio: every cataloged building grouped by category, then by business. */
export function portfolio(catalog: Catalog, w: Workspace | null, tasks: readonly StoredTask[]): Portfolio {
  const overrides = w?.categoryOverrides ?? {};
  const projectIds = new Set(catalog.projects.map((p) => p.id));
  const agentIds = new Set(catalog.agents.map((a) => a.id));
  const problems: string[] = [];
  for (const a of catalog.agents) if (a.status !== "retired" && !projectIds.has(a.projectId)) problems.push(`Agent ${a.name} points at building ${a.projectId}, which isn't in the catalog.`);
  for (const id of Object.keys(overrides)) if (!projectIds.has(id)) problems.push(`The workspace places ${id} in a category, but that building isn't in the catalog.`);
  const strayTasks = tasks.filter((t) => OPEN.has(t.status) && t.buildingId && !projectIds.has(t.buildingId));
  if (strayTasks.length) problems.push(`${strayTasks.length} open task${strayTasks.length === 1 ? "" : "s"} name a building that isn't in the catalog.`);
  const strayAgents = tasks.filter((t) => OPEN.has(t.status) && t.agentId && !agentIds.has(t.agentId));
  if (strayAgents.length) problems.push(`${strayAgents.length} open task${strayAgents.length === 1 ? "" : "s"} are assigned to an agent that isn't in the catalog.`);

  const agentProject = new Map(catalog.agents.map((a) => [a.id, a.projectId]));
  const taskProject = (t: StoredTask) => t.buildingId ?? (t.agentId ? agentProject.get(t.agentId) : undefined);
  const byProject = new Map<string, StoredTask[]>();
  for (const t of tasks) {
    const p = taskProject(t);
    if (p) byProject.set(p, [...(byProject.get(p) ?? []), t]);
  }

  const rows: PortfolioProject[] = catalog.projects.map((p) => {
    const agents = catalog.agents.filter((a) => a.projectId === p.id && a.status !== "retired");
    const own = new Set(agents.map((a) => a.id));
    const ts = byProject.get(p.id) ?? [];
    const { category, moved } = categoryOf(p, catalog, overrides);
    return {
      id: p.id,
      name: p.name,
      business: p.organization?.trim() || "Unassigned",
      category,
      moved,
      repositories: [...new Set([p.repository, ...(p.repositories ?? [])].filter(Boolean))],
      agents: agents.map((a) => ({ id: a.id, name: a.name, status: a.status })),
      workflows: TEMPLATES.filter((t) => requiredAgents(t).some((id) => own.has(id))).map((t) => ({ id: t.id, name: t.name })),
      openTasks: ts.filter((t) => OPEN.has(t.status)).length,
      completedTasks: ts.filter((t) => t.status === "completed").length,
      artifacts: ts.reduce((n, t) => n + t.artifacts.length, 0),
    };
  });

  const categories = CATEGORIES.map((id) => {
    const mine = rows.filter((r) => r.category === id);
    const names = [...new Set(mine.map((r) => r.business))].sort((a, b) => (a === "Unassigned" ? 1 : b === "Unassigned" ? -1 : a.localeCompare(b)));
    return { id, ...CATEGORY_INFO[id], businesses: names.map((name) => ({ name, projects: mine.filter((r) => r.business === name).sort((a, b) => a.name.localeCompare(b.name)) })) };
  });
  return { categories, problems };
}

// ---------------------------------------------------------------------------------------------
// Tool library: which agents, buildings and workflows use each integration.

export interface ToolUse {
  agents: { id: string; name: string }[];
  projects: { id: string; name: string }[];
  workflows: { id: string; name: string }[];
}

export function toolUse(catalog: Catalog): Record<string, ToolUse> {
  const names = new Map(catalog.projects.map((p) => [p.id, p.name]));
  const out: Record<string, ToolUse> = {};
  for (const def of INTEGRATION_CATALOG) out[def.id] = { agents: [], projects: [], workflows: [] };
  for (const a of catalog.agents) {
    if (a.status === "retired") continue;
    for (const id of integrationsFor(a)) {
      const u = out[id];
      if (!u) continue;
      u.agents.push({ id: a.id, name: a.name });
      if (!u.projects.some((p) => p.id === a.projectId) && names.has(a.projectId)) u.projects.push({ id: a.projectId, name: names.get(a.projectId)! });
    }
  }
  for (const t of TEMPLATES) for (const id of t.integrations) out[id]?.workflows.push({ id: t.id, name: t.name });
  for (const u of Object.values(out)) {
    u.agents.sort((a, b) => a.name.localeCompare(b.name));
    u.projects.sort((a, b) => a.name.localeCompare(b.name));
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Command brief: the eight questions Mission Control answers first. Pure, from records only.

export type BriefKey = "agents" | "workflows" | "attention" | "projects" | "problems" | "outputs" | "costs" | "goals";
export type BriefTarget = "tasks" | "workflows" | "business" | "usage" | "agents" | "grid";

export interface BriefLine {
  key: BriefKey;
  question: string;
  count: number;
  answer: string;
  /** "warn" when the owner should act, "quiet" when there is nothing to report. */
  tone: "warn" | "ok" | "quiet";
  target: BriefTarget;
}

export interface BriefInput {
  tasks: readonly StoredTask[];
  /** One status per workflow run, from execution/report runStatus. */
  runStatuses: readonly RunStatus[];
  /** Mission Focus items plus approvals waiting on the owner. */
  attention: number;
  /** Open agent alerts (failed or missing agent reports). */
  problems: number;
  /** Recorded AI cost this month, or null when nothing reported a cost. */
  aiCostUsd: number | null;
  costEstimated: boolean;
  /** Business goals by verdict, real records only. */
  goals: { atRisk: number; missed: number; metUnconfirmed: number; total: number };
  now: number;
  /** Days that count as "recent" for progress and outputs. */
  windowDays?: number;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function commandBrief(i: BriefInput): BriefLine[] {
  const since = i.now - (i.windowDays ?? 7) * 86_400_000;
  const recent = (iso?: string) => !!iso && Date.parse(iso) >= since;
  const agentTasks = i.tasks.filter((t) => t.agentId && (t.status === "running" || t.status === "queued"));
  const busyAgents = new Set(agentTasks.map((t) => t.agentId));
  const running = i.runStatuses.filter((s) => s === "running").length;
  const waiting = i.runStatuses.filter((s) => s === "waiting_on_person" || s === "awaiting_approval" || s === "blocked").length;
  const approvals = i.tasks.filter((t) => t.status === "awaiting_approval").length;
  const blocked = i.tasks.filter((t) => t.status === "blocked" || t.status === "failed").length;
  const needs = i.attention + approvals + blocked;
  const moving = new Set(i.tasks.filter((t) => t.status === "completed" && recent(t.completedAt)).map((t) => t.buildingId ?? t.agentId ?? t.id));
  const outputs = i.tasks.reduce((n, t) => n + t.artifacts.filter((a) => recent(a.at)).length, 0);
  const goalAction = i.goals.atRisk + i.goals.missed + i.goals.metUnconfirmed;
  const days = i.windowDays ?? 7;
  return [
    {
      key: "agents",
      question: "What are my agents doing?",
      count: busyAgents.size,
      answer: busyAgents.size ? `${plural(busyAgents.size, "agent")} on ${plural(agentTasks.length, "task")} (running or queued).` : "No agent has a running or queued task.",
      tone: busyAgents.size ? "ok" : "quiet",
      target: "tasks",
    },
    {
      key: "workflows",
      question: "Which workflows are running?",
      count: running,
      answer: running || waiting ? `${plural(running, "run")} in progress${waiting ? `, ${waiting} waiting on you or blocked` : ""}.` : "No workflow run is in progress.",
      tone: waiting ? "warn" : running ? "ok" : "quiet",
      target: "workflows",
    },
    {
      key: "attention",
      question: "What needs my attention?",
      count: needs,
      answer: needs ? [i.attention && plural(i.attention, "flagged item"), approvals && plural(approvals, "approval"), blocked && `${plural(blocked, "task")} blocked or failed`].filter(Boolean).join(", ") + "." : "Nothing is waiting on you.",
      tone: needs ? "warn" : "quiet",
      target: "tasks",
    },
    {
      key: "projects",
      question: "What projects are progressing?",
      count: moving.size,
      answer: moving.size ? `${plural(moving.size, "project")} finished work in the last ${days} days.` : `No task finished in the last ${days} days.`,
      tone: moving.size ? "ok" : "quiet",
      target: "grid",
    },
    {
      key: "problems",
      question: "Which systems have problems?",
      count: i.problems,
      answer: i.problems ? `${plural(i.problems, "open agent alert")}: failed or missing agent reports.` : "No open agent alerts.",
      tone: i.problems ? "warn" : "ok",
      target: "agents",
    },
    {
      key: "outputs",
      question: "What have agents produced?",
      count: outputs,
      answer: outputs ? `${plural(outputs, "output")} attached to tasks in the last ${days} days.` : `No task output was recorded in the last ${days} days.`,
      tone: outputs ? "ok" : "quiet",
      target: "workflows",
    },
    {
      key: "costs",
      question: "What is costing money?",
      count: i.aiCostUsd ?? 0,
      answer: i.aiCostUsd === null ? "No AI cost has been recorded on tasks this month." : `$${i.aiCostUsd.toFixed(2)} of AI usage recorded on tasks this month${i.costEstimated ? " (partly estimated)" : ""}.`,
      tone: i.aiCostUsd ? "ok" : "quiet",
      target: "usage",
    },
    {
      key: "goals",
      question: "Which business goals need action?",
      count: goalAction,
      answer: i.goals.total
        ? goalAction
          ? [i.goals.atRisk && `${i.goals.atRisk} at risk`, i.goals.missed && `${i.goals.missed} missed`, i.goals.metUnconfirmed && `${i.goals.metUnconfirmed} met, waiting for you to confirm`].filter(Boolean).join(", ") + "."
          : `All ${plural(i.goals.total, "goal")} on track.`
        : "No business goals set yet.",
      tone: goalAction ? "warn" : i.goals.total ? "ok" : "quiet",
      target: "business",
    },
  ];
}
