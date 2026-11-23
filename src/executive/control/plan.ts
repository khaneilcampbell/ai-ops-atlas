import { capability } from "../../intelligence/capabilities";
import { PLAN_LIMITS, REPORT_SECTION_LABEL, REPORT_SECTIONS, type ExecutivePlan, type PlanTask } from "./types";

// Goal checks, the deterministic planner and the plan checker. A plan is data; whoever drafts it (a
// template today, possibly a model later) it must pass checkPlan before a single task exists:
// strict shape, known capabilities, no duplicate keys, no cycles, bounded depth, size and cost.

const KEY = /^[a-z][a-z0-9-]{1,39}$/;
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

export type Check<T> = { ok: true; value: T } | { ok: false; problems: string[] };

/** Words that mean the goal asks for an owner-approval action. The research slice never plans those. */
const LEVEL4_WORDS = /\b(publish|deploy|delete|merge|spend|buy|pay|purchase|email|send|post|tweet|launch|rotate|credential|password|refund)\b/i;

export interface GoalInput {
  objective: string;
  budgetUsd?: number;
  /** 1 to 3; level 4 actions always wait for Khaneil whatever the goal's level. Default 2. */
  autonomy?: number;
}

/** GOAL_RECEIVED -> GOAL_VALIDATED: the objective itself, before any plan. */
export function validateGoal(input: unknown, maxBudget: number): Check<{ objective: string; budgetUsd: number | null; autonomy: 1 | 2 | 3 | null }> {
  const problems: string[] = [];
  const o = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const objective = typeof o.objective === "string" ? o.objective.replace(/\s+/g, " ").trim() : "";
  if (!objective) problems.push("Write the goal.");
  else if (objective.length < 12) problems.push("Say a little more about the goal (at least a short sentence).");
  if (objective.length > PLAN_LIMITS.maxObjectiveChars) problems.push(`Keep the goal under ${PLAN_LIMITS.maxObjectiveChars} characters.`);
  if (typeof o.objective === "string" && CONTROL.test(o.objective)) problems.push("The goal has hidden control characters.");
  let budgetUsd: number | null = null;
  if (o.budgetUsd !== undefined && o.budgetUsd !== null && o.budgetUsd !== "") {
    const b = Number(o.budgetUsd);
    if (!Number.isFinite(b) || b <= 0) problems.push("The budget must be a positive number of dollars.");
    else if (b > maxBudget) problems.push(`The budget can't be more than $${maxBudget.toFixed(2)} for one goal.`);
    else budgetUsd = Math.round(b * 100) / 100;
  }
  let autonomy: 1 | 2 | 3 | null = null;
  if (o.autonomy !== undefined && o.autonomy !== null && o.autonomy !== "") {
    const a = Number(o.autonomy);
    if (a === 1 || a === 2 || a === 3) autonomy = a;
    else problems.push("The autonomy level must be 1, 2 or 3 (level 4 actions always wait for Khaneil).");
  }
  return problems.length ? { ok: false, problems } : { ok: true, value: { objective, budgetUsd, autonomy } };
}

/** Plan templates. Each matches a goal by plain words and builds a fixed plan; no model is called. */
interface Template {
  id: string;
  matches: (objective: string) => boolean;
  build: (objective: string) => ExecutivePlan;
}

const RESEARCH_ACCEPTANCE = [
  `The report has all ${REPORT_SECTIONS.length} sections: ${REPORT_SECTIONS.map((s) => REPORT_SECTION_LABEL[s]).join(", ")}`,
  "At least 3 sources, each one a link the research run's own web search returned",
  "Competitor overview and market evidence each cite at least one of those sources",
  "No section is empty or a placeholder",
];

export const TEMPLATES: readonly Template[] = [
  {
    id: "opportunity-research",
    matches: (t) => /\b(research|investigate|assess|explore|find|evaluate)\b/i.test(t) && /\b(product|opportunit\w*|idea|market|offer|service)\b/i.test(t) && !LEVEL4_WORDS.test(t),
    build: (objective) => {
      const tasks: PlanTask[] = [
        {
          key: "research",
          title: "Research one opportunity and write the opportunity report",
          capability: "research.opportunity_report",
          dependsOn: [],
          acceptance: RESEARCH_ACCEPTANCE,
          maxCostUsd: 0.6,
          inputs: { objective, business: "Benjaire LLC" },
        },
        {
          key: "verify-and-report",
          title: "Verify the report and summarise the next step",
          capability: "executive.verify",
          dependsOn: ["research"],
          acceptance: ["Every check on the research report passed", "A summary and the recommended next step are recorded on the goal"],
          maxCostUsd: 0,
          inputs: {},
        },
      ];
      return {
        schema: "atlas-executive-plan/1",
        template: "opportunity-research",
        deliverables: ["A structured opportunity report with linked sources", "A short summary and one recommended next step for Khaneil"],
        acceptance: RESEARCH_ACCEPTANCE,
        tasks,
        estimatedCostUsd: tasks.reduce((s, t) => s + t.maxCostUsd, 0),
        risk: "low",
      };
    },
  },
];

/** GOAL_VALIDATED -> PLAN_GENERATED, or why no plan exists. */
export function draftPlan(objective: string): { ok: true; plan: ExecutivePlan } | { ok: false; reason: string } {
  if (LEVEL4_WORDS.test(objective))
    return { ok: false, reason: "This goal asks for something that needs Khaneil's approval (spending, publishing, deploying, deleting, merging, credentials or outside messages). The Executive doesn't plan those yet; it only researches and reports." };
  const t = TEMPLATES.find((x) => x.matches(objective));
  if (!t) return { ok: false, reason: "No plan template fits this goal yet. Today the Executive plans research goals (for example: research a Benjaire AI automation product and prepare an opportunity report). It doesn't ask a model to invent plans." };
  return { ok: true, plan: t.build(objective) };
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const strList = (v: unknown, max: number, len = 300) => Array.isArray(v) && v.length <= max && v.every((x) => typeof x === "string" && x.length > 0 && x.length <= len);

/** Strict shape check: any other field, type or size is refused (a malformed plan never becomes tasks). */
export function parsePlan(raw: unknown): Check<ExecutivePlan> {
  const problems: string[] = [];
  if (!isObj(raw)) return { ok: false, problems: ["The plan isn't an object."] };
  const allowed = new Set(["schema", "template", "deliverables", "acceptance", "tasks", "estimatedCostUsd", "risk"]);
  for (const k of Object.keys(raw)) if (!allowed.has(k)) problems.push(`Unknown plan field "${k}".`);
  if (raw.schema !== "atlas-executive-plan/1") problems.push("Unknown plan schema.");
  if (typeof raw.template !== "string" || !KEY.test(raw.template)) problems.push("Bad template id.");
  if (!strList(raw.deliverables, 10) || (raw.deliverables as unknown[]).length === 0) problems.push("The plan needs 1 to 10 deliverables.");
  if (!strList(raw.acceptance, 10) || (raw.acceptance as unknown[]).length === 0) problems.push("The plan needs 1 to 10 acceptance criteria.");
  if (raw.risk !== "low" && raw.risk !== "medium" && raw.risk !== "high") problems.push("Risk must be low, medium or high.");
  if (typeof raw.estimatedCostUsd !== "number" || !Number.isFinite(raw.estimatedCostUsd) || raw.estimatedCostUsd < 0) problems.push("Bad cost estimate.");
  if (!Array.isArray(raw.tasks) || raw.tasks.length === 0) problems.push("The plan has no tasks.");
  else if (raw.tasks.length > PLAN_LIMITS.maxTasks) problems.push(`At most ${PLAN_LIMITS.maxTasks} tasks in a plan.`);
  else
    raw.tasks.forEach((t, i) => {
      const at = `Task ${i + 1}`;
      if (!isObj(t)) return problems.push(`${at} isn't an object.`);
      const tk = new Set(["key", "title", "capability", "dependsOn", "acceptance", "maxCostUsd", "inputs"]);
      for (const k of Object.keys(t)) if (!tk.has(k)) problems.push(`${at}: unknown field "${k}".`);
      if (typeof t.key !== "string" || !KEY.test(t.key)) problems.push(`${at}: bad key.`);
      if (typeof t.title !== "string" || !t.title.trim() || t.title.length > 200) problems.push(`${at}: needs a title under 200 characters.`);
      if (typeof t.capability !== "string" || t.capability.length > 60) problems.push(`${at}: bad capability.`);
      if (!strList(t.dependsOn, PLAN_LIMITS.maxDependencies, 40)) problems.push(`${at}: at most ${PLAN_LIMITS.maxDependencies} dependencies.`);
      if (!strList(t.acceptance, 10) || (t.acceptance as unknown[]).length === 0) problems.push(`${at}: needs acceptance criteria.`);
      if (typeof t.maxCostUsd !== "number" || !Number.isFinite(t.maxCostUsd) || t.maxCostUsd < 0) problems.push(`${at}: bad cost cap.`);
      if (!isObj(t.inputs) || Object.values(t.inputs).some((v) => typeof v !== "string" || v.length > 2000)) problems.push(`${at}: inputs must be short text.`);
    });
  return problems.length ? { ok: false, problems } : { ok: true, value: raw as unknown as ExecutivePlan };
}

/** Longest dependency chain, or null when there's a cycle. */
export function depthOf(tasks: readonly Pick<PlanTask, "key" | "dependsOn">[]): number | null {
  const by = new Map(tasks.map((t) => [t.key, t]));
  const memo = new Map<string, number>();
  const visiting = new Set<string>();
  const depth = (k: string): number | null => {
    if (memo.has(k)) return memo.get(k)!;
    if (visiting.has(k)) return null;
    visiting.add(k);
    let d = 1;
    for (const dep of by.get(k)?.dependsOn ?? []) {
      if (!by.has(dep)) continue;
      const x = depth(dep);
      if (x === null) return null;
      d = Math.max(d, x + 1);
    }
    visiting.delete(k);
    memo.set(k, d);
    return d;
  };
  let max = 0;
  for (const t of tasks) {
    const d = depth(t.key);
    if (d === null) return null;
    max = Math.max(max, d);
  }
  return max;
}

/** PLAN_GENERATED -> PLAN_CHECKED: shape, capabilities, duplicates, cycles, limits and contradictions. */
export function checkPlan(raw: unknown, goal: { budgetUsd: number }): Check<ExecutivePlan> {
  const parsed = parsePlan(raw);
  if (!parsed.ok) return parsed;
  const plan = parsed.value;
  const problems: string[] = [];
  const keys = new Set<string>();
  const titles = new Set<string>();
  for (const t of plan.tasks) {
    if (keys.has(t.key)) problems.push(`Two tasks share the key "${t.key}".`);
    keys.add(t.key);
    const sig = `${t.capability}|${t.title.toLowerCase().trim()}`;
    if (titles.has(sig)) problems.push(`"${t.title}" appears twice.`);
    titles.add(sig);
    const cap = capability(t.capability);
    if (!cap) problems.push(`"${t.title}" needs "${t.capability}", which isn't a capability Atlas has.`);
    else if (cap.neverFromAtlas || cap.adapter === "none") problems.push(`"${t.title}" needs ${cap.name}, which never starts from Atlas.`);
    if (t.maxCostUsd > PLAN_LIMITS.maxTaskCostUsd) problems.push(`"${t.title}" may cost up to $${t.maxCostUsd}; the limit per task is $${PLAN_LIMITS.maxTaskCostUsd}.`);
    if (t.dependsOn.includes(t.key)) problems.push(`"${t.title}" depends on itself.`);
  }
  for (const t of plan.tasks) for (const d of t.dependsOn) if (!keys.has(d)) problems.push(`"${t.title}" depends on "${d}", which isn't in the plan.`);
  const depth = depthOf(plan.tasks);
  if (depth === null) problems.push("The plan's dependencies go in a circle.");
  else if (depth > PLAN_LIMITS.maxDepth) problems.push(`The plan is ${depth} steps deep; the limit is ${PLAN_LIMITS.maxDepth}.`);
  const total = plan.tasks.reduce((s, t) => s + t.maxCostUsd, 0);
  if (Math.abs(total - plan.estimatedCostUsd) > 0.001) problems.push("The plan's cost estimate doesn't match its tasks.");
  if (total > PLAN_LIMITS.maxPlanCostUsd) problems.push(`The plan may cost $${total.toFixed(2)}; the limit is $${PLAN_LIMITS.maxPlanCostUsd}.`);
  // Contradiction: a goal with a budget smaller than the plan's own estimate can't succeed as planned.
  if (total > goal.budgetUsd) problems.push(`The plan may cost up to $${total.toFixed(2)}, more than the goal's $${goal.budgetUsd.toFixed(2)} budget.`);
  return problems.length ? { ok: false, problems } : { ok: true, value: plan };
}

// ---- Explicit templates (Phase 2) -------------------------------------------------------------------
// Goals Atlas opens itself (an engineering incident) name their template and inputs instead of being
// matched by words. The plan still goes through checkPlan like any other.

const CI_REPAIR_ACCEPTANCE = [
  "The approved checks pass in a clean runner with no secrets, as GitHub itself reports",
  "Atlas QA passes the real diff: small, no protected file, no silenced check, no deleted test",
  "A review-ready pull request exists for the branch QA checked; nobody merged it",
];

export const ENGINEERING_TEMPLATE = "engineering-ci-repair";

/** The fixed engineering plan: implement -> QA -> deliver -> report. Repairs add tasks later (engine). */
export function engineeringPlan(inputs: Record<string, string>, implementCapUsd: number): ExecutivePlan {
  const tasks: PlanTask[] = [
    {
      key: "implement",
      title: `Investigate and fix the failing ${inputs.category ?? "check"} in ${inputs.repo ?? "the repository"}`,
      capability: "engineering.implement_fix",
      dependsOn: [],
      acceptance: ["A change on this task's atlas-eng/ branch, inside the size limit, touching no protected file"],
      maxCostUsd: implementCapUsd,
      inputs: { ...inputs, repair_iteration: "0", feedback: "" },
    },
    { key: "qa", title: "Independently verify the change", capability: "qa.verify_change", dependsOn: ["implement"], acceptance: ["QA outcome PASS from GitHub's own results"], maxCostUsd: 0, inputs: { repo: inputs.repo ?? "", base_sha: inputs.base_sha ?? "" } },
    { key: "deliver", title: "Open a review-ready pull request", capability: "engineering.deliver_pr", dependsOn: ["qa"], acceptance: ["The pull request is for the exact commit QA checked"], maxCostUsd: 0, inputs: { repo: inputs.repo ?? "" } },
    { key: "report", title: "Record the outcome and the remaining risks", capability: "executive.verify", dependsOn: ["deliver"], acceptance: ["A completion summary with the pull request link is on the goal"], maxCostUsd: 0, inputs: {} },
  ];
  return {
    schema: "atlas-executive-plan/1",
    template: ENGINEERING_TEMPLATE,
    deliverables: ["A review-ready pull request with test and risk evidence", "A QA report read from GitHub", "A completion summary"],
    acceptance: CI_REPAIR_ACCEPTANCE,
    tasks,
    estimatedCostUsd: tasks.reduce((s, t) => s + t.maxCostUsd, 0),
    risk: "medium",
  };
}

export function draftTemplatePlan(template: string, inputs: Record<string, string>, implementCapUsd: number): { ok: true; plan: ExecutivePlan } | { ok: false; reason: string } {
  if (template === ENGINEERING_TEMPLATE) return { ok: true, plan: engineeringPlan(inputs, implementCapUsd) };
  return { ok: false, reason: `Unknown plan template ${template}.` };
}
