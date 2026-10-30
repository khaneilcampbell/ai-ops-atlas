// Full reports from agents that run outside the app (today: Opportunity Scout on GitHub Actions).
// The live feed only carries a 300-character line per run; a report is the whole result, stored by
// the site (server/reports.ts) behind Cloudflare Access and shown in the agent's inspector. The same
// check runs on the site before storing and in the app before showing, so a malformed report is
// dropped, never half drawn.

/** Agents allowed to store reports. Anything else is refused by the site. */
export const REPORT_AGENTS = ["github-opportunity-scout"] as const;
export type ReportAgent = (typeof REPORT_AGENTS)[number];

export const MECHANISMS = ["service", "product", "lead_generation", "client_automation", "other"] as const;
export const MECHANISM_LABEL: Record<(typeof MECHANISMS)[number], string> = {
  service: "Service",
  product: "Product",
  lead_generation: "Lead generation",
  client_automation: "Automation for clients",
  other: "Other",
};
export const SCALES = ["revenue", "effort", "cost", "risk"] as const;

export interface OpportunityIdea {
  title: string;
  mechanism: (typeof MECHANISMS)[number];
  customer: string;
  reuses: string[];
  days_to_first_dollar: number;
  monthly_cost_usd: number;
  risks: string;
  scores: Record<(typeof SCALES)[number], number>;
  /** (2 x revenue + effort + cost + risk) / 5, computed by the agent, never by the model. */
  score: number;
}

export interface AgentSpec {
  idea: string;
  name: string;
  purpose: string;
  trigger: string;
  schedule: string;
  inputs: string[];
  outputs: string[];
  monthly_cap_usd: number;
  building: string;
  approval_point: string;
}

export interface OpportunityReport {
  agent: ReportAgent;
  at: string;
  run_url: string | null;
  model: string;
  cost_usd: number;
  registry: { projects: number; agents: number };
  ideas: OpportunityIdea[];
  spec: AgentSpec | null;
  notes: string[];
}

/** A stored report as the site returns it. */
export interface StoredReport {
  id: number;
  at: string;
  body: OpportunityReport;
}

export const MAX_REPORT_BYTES = 16_000;
const ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const RUN_URL = /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/actions\/runs\/\d+$/;

type J = Record<string, unknown>;
const obj = (x: unknown): x is J => !!x && typeof x === "object" && !Array.isArray(x);
const text = (x: unknown, max: number, empty = false): x is string => typeof x === "string" && x.length <= max && (empty || x.trim().length > 0);
const num = (x: unknown, max: number): x is number => typeof x === "number" && Number.isFinite(x) && x >= 0 && x <= max;
const list = (x: unknown, items: number, max: number): x is string[] => Array.isArray(x) && x.length <= items && x.every((s) => text(s, max));
const only = (o: J, keys: readonly string[]) => Object.keys(o).every((k) => keys.includes(k));

const IDEA_KEYS = ["title", "mechanism", "customer", "reuses", "days_to_first_dollar", "monthly_cost_usd", "risks", "scores", "score"] as const;
const SPEC_KEYS = ["idea", "name", "purpose", "trigger", "schedule", "inputs", "outputs", "monthly_cap_usd", "building", "approval_point"] as const;
const REPORT_KEYS = ["agent", "at", "run_url", "model", "cost_usd", "registry", "ideas", "spec", "notes"] as const;

function validIdea(i: unknown): i is OpportunityIdea {
  if (!obj(i) || !only(i, IDEA_KEYS)) return false;
  const s = i.scores;
  return (
    text(i.title, 160) &&
    (MECHANISMS as readonly unknown[]).includes(i.mechanism) &&
    text(i.customer, 400) &&
    Array.isArray(i.reuses) && i.reuses.length <= 12 && i.reuses.every((r) => typeof r === "string" && ID.test(r)) &&
    num(i.days_to_first_dollar, 3650) &&
    num(i.monthly_cost_usd, 10_000) &&
    text(i.risks, 600, true) &&
    obj(s) && only(s, SCALES) && SCALES.every((k) => Number.isInteger(s[k]) && (s[k] as number) >= 1 && (s[k] as number) <= 5) &&
    num(i.score, 5)
  );
}

function validSpec(s: unknown): s is AgentSpec {
  return (
    obj(s) && only(s, SPEC_KEYS) &&
    text(s.idea, 160) && text(s.name, 120) && text(s.purpose, 600) && text(s.trigger, 300) && text(s.schedule, 300) &&
    list(s.inputs, 12, 300) && list(s.outputs, 12, 300) &&
    num(s.monthly_cap_usd, 5) &&
    typeof s.building === "string" && ID.test(s.building) &&
    text(s.approval_point, 400, true)
  );
}

/** Every field checked, nothing extra allowed. */
export function validOpportunityReport(value: unknown): value is OpportunityReport {
  if (!obj(value) || !only(value, REPORT_KEYS)) return false;
  const r = value;
  return (
    (REPORT_AGENTS as readonly unknown[]).includes(r.agent) &&
    typeof r.at === "string" && !Number.isNaN(Date.parse(r.at)) &&
    (r.run_url === null || (typeof r.run_url === "string" && RUN_URL.test(r.run_url))) &&
    text(r.model, 64) &&
    num(r.cost_usd, 5) &&
    obj(r.registry) && only(r.registry, ["projects", "agents"]) && Number.isInteger(r.registry.projects) && Number.isInteger(r.registry.agents) &&
    Array.isArray(r.ideas) && r.ideas.length <= 3 && r.ideas.every(validIdea) &&
    (r.spec === null || validSpec(r.spec)) &&
    list(r.notes, 12, 400)
  );
}

export function isReportAgent(id: string): id is ReportAgent {
  return (REPORT_AGENTS as readonly string[]).includes(id);
}
