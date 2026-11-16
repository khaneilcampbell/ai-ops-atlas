import type { Catalog } from "../catalog/types";
import { routeForStep } from "../intelligence/benjaire";
import type { SensitiveCategory } from "../tasks/types";
import { DEFINITIONS } from "../workflows/benjaireLaunch";
import { simPhases, simulate, type SimState } from "../workflows/engine";
import { definitionProblems } from "../workflows/graph";
import type { WorkflowDefinition, WorkflowNode } from "../workflows/types";
import { usable, type IntegrationState } from "./integrations";
import { agentBlocked, settingsFor, type Workspace } from "./workspace";

// Workflow Template Library: reusable descriptions on top of Workflow Intelligence definitions. A
// template only says "executable" when a real definition backs it and that definition passes the
// graph checks; the rest are listed as designs with what's missing. Running still goes through
// Workflow Intelligence's own confirm-and-start path: there is no second engine here.

export interface TemplateInput {
  id: string;
  label: string;
  required: boolean;
  /** Filled from the workspace, so no business name is hardcoded in the template. */
  fromWorkspace?: "primaryBusiness" | "name";
  example?: string;
}

export interface WorkflowTemplate {
  id: string;
  name: string;
  description: string;
  category: "product" | "engineering" | "operations" | "customers" | "research";
  /** Workflow Intelligence definition that runs it. Null: a design only, not executable. */
  definitionId: string | null;
  /** For design-only templates: what would be needed to make it real. */
  missing?: string;
  /** Required agents when there's no definition to read them from. */
  agents?: string[];
  integrations: string[];
  inputs: TemplateInput[];
  outputs: string[];
  instructions: string[];
  /** Workspace that ships the reference configuration (an example, never a requirement). */
  example?: string;
}

export const TEMPLATES: readonly WorkflowTemplate[] = [
  {
    id: "product-research-launch",
    name: "Product Research & Launch",
    description: "Research demand, customers and competitors, score the idea, write a brief, build, launch with approval, and watch it after launch.",
    category: "product",
    definitionId: "benjaire-ai-product-launch",
    integrations: ["n8n", "github"],
    inputs: [
      { id: "business", label: "Business", required: true, fromWorkspace: "primaryBusiness" },
      { id: "goal", label: "Product goal", required: true, example: "An AI automation product for small agencies" },
      { id: "budget", label: "Spend cap for the run (USD)", required: false, example: "5" },
    ],
    outputs: ["Research report with sources", "Viability score and decision", "Product brief", "Approved launch, or a recorded stop"],
    instructions: [
      "Add the workflow's agents to this workspace and keep them turned on.",
      "Connect n8n with the Step Runner keys so research steps can run; the rest are recorded by a person in the Task Center.",
      "Preview and simulate here, then open it in Workflow Intelligence to start a live run. Launch and spending steps always wait for your approval.",
    ],
    example: "Benjaire",
  },
  {
    id: "business-opportunity-research",
    name: "Business opportunity research",
    description: "Scan for opportunities on a schedule and turn the best into ranked ideas for review.",
    category: "research",
    definitionId: null,
    missing: "No Workflow Intelligence definition yet. Opportunity Scout runs on its own GitHub schedule; its reports appear in Intel.",
    agents: ["github-opportunity-scout"],
    integrations: ["github"],
    inputs: [{ id: "topic", label: "Markets to scan", required: true }],
    outputs: ["Ranked opportunity report"],
    instructions: ["Use Opportunity Scout from Agents today."],
  },
  {
    id: "customer-inquiry-handling",
    name: "Customer inquiry handling",
    description: "Sort incoming inquiries, draft replies for approval, and record the outcome.",
    category: "customers",
    definitionId: null,
    missing: "No definition yet. The inquiry inbox on Benjaire HQ handles replies by hand with approval.",
    integrations: ["cloudflare"],
    inputs: [{ id: "inbox", label: "Inquiry source", required: true }],
    outputs: ["Approved replies", "Inquiry log"],
    instructions: ["Use the inquiry inbox on Benjaire HQ today."],
  },
  {
    id: "repository-health-monitoring",
    name: "Repository health monitoring",
    description: "Watch CI, failing agents and open security alerts across repositories, and open fixes for review.",
    category: "engineering",
    definitionId: null,
    missing: "No definition yet. The CI pill, alerts and the Engineering Reviewer already cover the checks.",
    agents: ["atlas-engineering-review", "github-merge-flow"],
    integrations: ["github"],
    inputs: [{ id: "repos", label: "Repositories", required: false }],
    outputs: ["Health report", "Fix pull requests for review"],
    instructions: ["Use Mission Control and Intel today."],
  },
  {
    id: "infrastructure-monitoring",
    name: "Infrastructure monitoring",
    description: "Check the site, database, n8n and agents on a schedule and raise alerts.",
    category: "operations",
    definitionId: null,
    missing: "No definition yet. Production health in Mission Control and email alerts cover it without a workflow.",
    integrations: ["cloudflare", "n8n", "email-alerts"],
    inputs: [],
    outputs: ["Health report", "Alert emails"],
    instructions: ["Use Production health in Mission Control today."],
  },
];

export const templateById = (id: string) => TEMPLATES.find((t) => t.id === id);
export const definitionOf = (t: WorkflowTemplate): WorkflowDefinition | null => (t.definitionId ? (DEFINITIONS[t.definitionId] ?? null) : null);

export function requiredAgents(t: WorkflowTemplate): string[] {
  const d = definitionOf(t);
  return d ? [...new Set(d.nodes.map((n) => n.agentId).filter((x): x is string => !!x))] : [...(t.agents ?? [])];
}

export function approvalsOf(t: WorkflowTemplate): { step: string; categories: SensitiveCategory[]; reason: string }[] {
  return (definitionOf(t)?.nodes ?? []).filter((n) => n.approval).map((n) => ({ step: n.title, categories: n.approval!.categories, reason: n.approval!.reason }));
}

export const versionOf = (t: WorkflowTemplate) => definitionOf(t)?.version ?? null;

export interface Compatibility {
  executable: boolean;
  /** Everything it needs is in place for this workspace. */
  ready: boolean;
  problems: string[];
  warnings: string[];
}

/** Checks a template against the registry, the workspace and the integrations. */
export function compatibility(t: WorkflowTemplate, w: Workspace | null, catalog: Catalog, integrations: readonly IntegrationState[]): Compatibility {
  const problems: string[] = [];
  const warnings: string[] = [];
  const d = definitionOf(t);
  if (!t.definitionId) problems.push(t.missing ?? "No workflow definition backs this template.");
  else if (!d) problems.push(`Its definition ${t.definitionId} isn't in this build.`);
  else problems.push(...definitionProblems(d));
  const known = new Set(catalog.agents.map((a) => a.id));
  for (const id of requiredAgents(t)) {
    const name = catalog.agents.find((a) => a.id === id)?.name ?? id;
    if (!known.has(id)) problems.push(`${id} isn't in the Agent Registry.`);
    else {
      const blocked = agentBlocked(w, id);
      if (blocked) problems.push(`${name} ${blocked}.`);
    }
  }
  for (const id of t.integrations) {
    const s = integrations.find((x) => x.def.id === id);
    if (!s) warnings.push(`${id} isn't an Atlas integration.`);
    else if (!usable(s)) warnings.push(`${s.def.label} is ${s.status.replace("_", " ")}: ${s.detail}`);
  }
  for (const n of d?.nodes ?? []) if (n.unconfigured) warnings.push(`${n.title}: ${n.unconfigured}`);
  for (const i of t.inputs) if (i.required && i.fromWorkspace && w && !w[i.fromWorkspace]) problems.push(`Set the workspace's ${i.label.toLowerCase()} first.`);
  const executable = !!d && problems.every((p) => !p.startsWith("No workflow") && !p.includes("isn't in this build"));
  return { executable, ready: !!d && problems.length === 0, problems, warnings };
}

/**
 * Why the workspace stops this step's agent from taking new work, or null when it may. Checked by
 * Workflow Intelligence's Start button and again by the orchestrator before every send, so turning
 * an agent off (or lowering its model limit) also holds steps of runs that already started.
 */
export function stepProblem(n: Pick<WorkflowNode, "id" | "kind" | "execution" | "agentId" | "title">, w: Workspace | null, catalog: Catalog): string | null {
  if (!w || !n.agentId) return null;
  const name = catalog.agents.find((a) => a.id === n.agentId)?.name ?? n.agentId;
  const blocked = agentBlocked(w, n.agentId);
  if (blocked) return `${name} ${blocked}. Turn it on in Workspace > Agents to let it run.`;
  const tier = routeForStep(n, undefined, catalog).tier;
  const limit = settingsFor(w, n.agentId).maxModelTier;
  if (tier > limit) return `${n.title} needs Tier ${tier} models, but ${name} is limited to Tier ${limit} in this workspace.`;
  return null;
}

/**
 * Why a live run of this definition can't start in this workspace, or null when it can. Checked by
 * Workflow Intelligence's Start button: disabled agents never get tasks, and a step whose model
 * route needs a tier above the workspace's limit for that agent holds the whole run.
 */
export function runProblem(def: WorkflowDefinition, w: Workspace | null, catalog: Catalog): string | null {
  for (const n of def.nodes) {
    const p = stepProblem(n, w, catalog);
    if (p) return p;
  }
  return null;
}

/** Why the workspace stops this agent from taking a new Task Center task, or null. */
export function taskAgentProblem(agentId: string | undefined, w: Workspace | null, catalog: Catalog): string | null {
  if (!agentId) return null;
  const blocked = agentBlocked(w, agentId);
  if (!blocked) return null;
  const name = catalog.agents.find((a) => a.id === agentId)?.name ?? agentId;
  return `${name} ${blocked}, so it can't take new tasks. Turn it on in Workspace > Agents.`;
}

/** A dry run of the whole template: computed, never saved, no tasks and no outside calls. */
export function simulateTemplate(t: WorkflowTemplate, opts: { viable: boolean; standIn: boolean }, names: (id: string) => string): SimState | null {
  const d = definitionOf(t);
  if (!d) return null;
  const branches = Object.fromEntries(d.nodes.filter((n) => n.kind === "decision").map((n) => [n.id, opts.viable ? ("yes" as const) : ("no" as const)]));
  const o = { branches, manualStandIn: opts.standIn };
  // Clamped to the final step, so the result shows the whole run.
  return simulate(d, o, simPhases(d, o).phases.length + 1, names);
}

/** The goal a template run would pursue for this workspace, built from its inputs. */
export function goalText(t: WorkflowTemplate, w: Workspace | null, values: Record<string, string>): string {
  const business = values.business || w?.primaryBusiness || "your business";
  return `${t.name} for ${business}${values.goal ? `: ${values.goal}` : ""}`;
}
