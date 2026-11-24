import type { Catalog } from "../catalog/types";
import type { SensitiveCategory } from "../tasks/types";

// Tool intelligence: the capabilities an agent may use, described so Atlas can check them with
// plain rules. Each agent's grant list extends its Agent Registry entry. Matching is
// deterministic (intent tags and side-effect limits); an agent asking for a tool that isn't here
// is refused, never mapped to something close, and nothing here runs arbitrary commands.

export type SideEffect = "none" | "internal_write" | "external_write" | "spend" | "publish";
export const SIDE_EFFECT_LABEL: Record<SideEffect, string> = {
  none: "Read only",
  internal_write: "Writes inside Atlas",
  external_write: "Changes an outside system",
  spend: "Spends model or API money",
  publish: "Publishes or deploys",
};
const SIDE_RANK: Record<SideEffect, number> = { none: 0, internal_write: 1, spend: 2, external_write: 3, publish: 4 };

export interface Capability {
  id: string;
  name: string;
  description: string;
  /** Field name -> type, for the request the tool takes. */
  input: Record<string, string>;
  output: Record<string, string>;
  /** Plain words: what access running it needs. */
  permissions: string[];
  /** What actually carries it out. "none" means Atlas has no way to run it. */
  adapter: "atlas" | "n8n-step-runner" | "n8n-executive" | "anthropic-web-search" | "github-touchid" | "none";
  sideEffect: SideEffect;
  timeoutMs: number;
  retry: { max: number; backoff: "none" | "exponential"; onlyTransient: boolean };
  /** Needs a person's approval for the run before it may be used. */
  approval?: SensitiveCategory[];
  /** Never started from Atlas, whoever asks. */
  neverFromAtlas?: boolean;
  intents: string[];
}

const MIN = 60_000;

export const CAPABILITIES: readonly Capability[] = [
  { id: "memory.retrieve", name: "Retrieve knowledge", description: "Search Atlas memory the agent may read, within a token budget.", input: { query: "string", budgetTokens: "number" }, output: { items: "RetrievedItem[]" }, permissions: ["Read own building and workflow memory"], adapter: "atlas", sideEffect: "none", timeoutMs: 5_000, retry: { max: 0, backoff: "none", onlyTransient: true }, intents: ["knowledge", "context", "retrieve", "search-memory"] },
  { id: "memory.write_working", name: "Note working memory", description: "Save an intermediate finding for this workflow. Expires in 7 days.", input: { title: "string", content: "string", scope: "MemoryScope" }, output: { id: "string" }, permissions: ["Write working memory in own building or workflow"], adapter: "atlas", sideEffect: "internal_write", timeoutMs: 5_000, retry: { max: 0, backoff: "none", onlyTransient: true }, intents: ["note", "finding", "working-memory"] },
  { id: "memory.propose_operational", name: "Report an operational lesson", description: "Record a failure pattern or recovery step, unverified until Khaneil verifies it.", input: { title: "string", content: "string" }, output: { id: "string" }, permissions: ["Write unverified operational memory"], adapter: "atlas", sideEffect: "internal_write", timeoutMs: 5_000, retry: { max: 0, backoff: "none", onlyTransient: true }, intents: ["lesson", "failure-pattern", "recovery"] },
  { id: "research.web_search", name: "Web search", description: "Anthropic web search inside the step runner, at most 5 searches a run.", input: { query: "string" }, output: { results: "link[]" }, permissions: ["Anthropic web search (n8n credential)"], adapter: "anthropic-web-search", sideEffect: "spend", timeoutMs: 2 * MIN, retry: { max: 1, backoff: "exponential", onlyTransient: true }, intents: ["research", "web", "demand-signals", "competitors", "customers"] },
  // Atlas Executive (server control plane): one web-search research run in the n8n Executive Dispatch workflow.
  { id: "research.opportunity_report", name: "Opportunity research report", description: "One Claude run with web search (at most 5 searches) in the n8n Executive Dispatch workflow, returning a 7-section report with linked sources.", input: { objective: "string" }, output: { report: "OpportunityReport" }, permissions: ["Anthropic web search (n8n credential)", "Executive callback key (site)"], adapter: "n8n-executive", sideEffect: "spend", timeoutMs: 5 * MIN, retry: { max: 2, backoff: "exponential", onlyTransient: true }, intents: ["research", "opportunity", "market", "competitors", "report"] },
  { id: "executive.verify", name: "Verify and summarise results", description: "Atlas's own checks on a returned report (sections, sources, links) and a plain summary. No model.", input: { report: "OpportunityReport" }, output: { verification: "Verification" }, permissions: ["Read the goal's results in the Atlas database"], adapter: "atlas", sideEffect: "internal_write", timeoutMs: 10_000, retry: { max: 0, backoff: "none", onlyTransient: true }, intents: ["verify", "summarise", "review"] },
  { id: "model.light", name: "Lightweight model call", description: "Tier 1: classification, extraction or a short summary.", input: { prompt: "string" }, output: { text: "string" }, permissions: ["Model budget for the step"], adapter: "n8n-step-runner", sideEffect: "spend", timeoutMs: 2 * MIN, retry: { max: 2, backoff: "exponential", onlyTransient: true }, intents: ["classify", "extract", "summarise"] },
  { id: "model.advanced", name: "Advanced model call", description: "Tier 2: research synthesis, scoring, planning or root-cause analysis.", input: { prompt: "string" }, output: { text: "string" }, permissions: ["Model budget for the step"], adapter: "n8n-step-runner", sideEffect: "spend", timeoutMs: 5 * MIN, retry: { max: 2, backoff: "exponential", onlyTransient: true }, intents: ["synthesise", "score", "plan", "root-cause", "research"] },
  { id: "handoff.report", name: "Report a step result", description: "Return the step's schema-checked output and artifact links to Atlas.", input: { output: "StepOutput" }, output: { accepted: "boolean" }, permissions: ["Step runner callback key (site)"], adapter: "n8n-step-runner", sideEffect: "internal_write", timeoutMs: 30_000, retry: { max: 3, backoff: "exponential", onlyTransient: true }, intents: ["handoff", "report", "artifact"] },
  { id: "decision.record", name: "Record a recommendation", description: "A decision summary with evidence, alternatives and uncertainty. High-impact ones go to Khaneil.", input: { recommendation: "string", evidence: "EvidenceRef[]" }, output: { id: "string", review: "string" }, permissions: ["Write decision records"], adapter: "atlas", sideEffect: "internal_write", timeoutMs: 5_000, retry: { max: 0, backoff: "none", onlyTransient: true }, intents: ["recommend", "decision"] },
  { id: "improvement.propose", name: "Propose an improvement", description: "Suggest a prompt, knowledge, workflow or validation change for Khaneil to review.", input: { kind: "ProposalKind", change: "string" }, output: { id: "string" }, permissions: ["Write improvement proposals"], adapter: "atlas", sideEffect: "internal_write", timeoutMs: 5_000, retry: { max: 0, backoff: "none", onlyTransient: true }, intents: ["improve", "proposal"] },
  { id: "tasks.delegate", name: "Delegate workflow steps", description: "Create Task Center tasks for each workflow step with owner and dependencies.", input: { goal: "Goal" }, output: { taskIds: "string[]" }, permissions: ["Create Task Center tasks"], adapter: "atlas", sideEffect: "internal_write", timeoutMs: 10_000, retry: { max: 0, backoff: "none", onlyTransient: true }, intents: ["delegate", "intake", "coordinate"] },
  { id: "status.read", name: "Read Atlas status records", description: "Repository, CI, health, Task Center and n8n run records Atlas already fetches. Changes nothing.", input: { resource: "string" }, output: { records: "StatusRecord[]" }, permissions: ["Read records already on this device"], adapter: "atlas", sideEffect: "none", timeoutMs: 10_000, retry: { max: 1, backoff: "none", onlyTransient: true }, intents: ["status", "health", "review", "monitor"] },
  { id: "github.run_workflow", name: "Run a GitHub workflow", description: "Start an allow-listed GitHub Actions workflow after Touch ID in the Mac app.", input: { agentId: "string" }, output: { runId: "string" }, permissions: ["Manage agents token (Mac Keychain)", "Touch ID"], adapter: "github-touchid", sideEffect: "external_write", timeoutMs: 2 * 60 * MIN, retry: { max: 0, backoff: "none", onlyTransient: true }, approval: ["repository_change"], intents: ["build", "ci"] },
  { id: "shop.publish", name: "Publish a product", description: "Approve and Publish (n8n). Runs only from Khaneil's approval form.", input: { productId: "string" }, output: { listing: "string" }, permissions: ["Shopify write (n8n credential)"], adapter: "none", sideEffect: "publish", timeoutMs: 10 * MIN, retry: { max: 0, backoff: "none", onlyTransient: true }, approval: ["customer_message", "financial"], neverFromAtlas: true, intents: ["publish", "launch"] },
];

const RESEARCHER = ["memory.retrieve", "memory.write_working", "memory.propose_operational", "research.web_search", "model.light", "model.advanced", "handoff.report", "improvement.propose"];

const ENGINEERING_READ = ["memory.retrieve", "memory.write_working", "status.read", "decision.record"];

/** What each agent in a saved plan may use (Benjaire launch, Phase 8 executive plans). An agent not listed has no capabilities through Atlas. */
export const AGENT_GRANTS: Readonly<Record<string, readonly string[]>> = {
  "agent-operations-lead": ["memory.retrieve", "memory.write_working", "memory.propose_operational", "tasks.delegate", "decision.record", "improvement.propose", "status.read"],
  "benjaire-product-lab-research": [...RESEARCHER, "research.opportunity_report"],
  "benjaire-product-lab-customers": RESEARCHER,
  "benjaire-product-lab-competitors": RESEARCHER,
  "benjaire-product-lab-scoring": ["memory.retrieve", "memory.write_working", "model.advanced", "handoff.report", "decision.record", "improvement.propose"],
  "benjaire-product-lab-brief": ["memory.retrieve", "memory.write_working", "model.light", "model.advanced", "handoff.report", "improvement.propose"],
  "benjaire-product-lab": ["memory.retrieve", "memory.write_working", "memory.propose_operational", "model.advanced", "handoff.report", "decision.record", "improvement.propose"],
  // Atlas Executive (server control plane, 2026-11-22): plans, delegates and verifies. It runs no model itself.
  "atlas-executive": ["tasks.delegate", "status.read", "decision.record", "executive.verify"],
  // Phase 8 executive plans: read-only status work. None of these may change a repository through Atlas.
  "repo-intelligence": ENGINEERING_READ,
  "atlas-ci": ENGINEERING_READ,
  "atlas-health-monitor": ENGINEERING_READ,
  "atlas-release-manager": ENGINEERING_READ,
  "documentation-lead": ENGINEERING_READ,
};

export const capability = (id: string) => CAPABILITIES.find((c) => c.id === id);

export function grantsFor(agentId: string): Capability[] {
  return (AGENT_GRANTS[agentId] ?? []).map((id) => capability(id)).filter((c): c is Capability => !!c);
}

export interface AuthorizeContext {
  /** Approval categories a person granted for this run. */
  approved?: SensitiveCategory[];
}

/** Whether the agent may use the tool for this run. Unknown tools are refused, never guessed. */
export function authorize(agentId: string, capId: string, ctx: AuthorizeContext = {}, catalog?: Catalog): { ok: true; capability: Capability } | { ok: false; error: string } {
  const cap = capability(capId);
  if (!cap) return { ok: false, error: `No tool called "${capId}" exists in Atlas.` };
  if (catalog && !catalog.agents.some((a) => a.id === agentId)) return { ok: false, error: `Unknown agent ${agentId}.` };
  if (cap.neverFromAtlas) return { ok: false, error: `${cap.name} never starts from Atlas.` };
  if (!(AGENT_GRANTS[agentId] ?? []).includes(capId)) return { ok: false, error: `${agentId} isn't authorised to use ${cap.name}.` };
  const missing = (cap.approval ?? []).filter((c) => !(ctx.approved ?? []).includes(c));
  if (missing.length) return { ok: false, error: `${cap.name} needs Khaneil's approval for this run (${missing.join(", ")}).` };
  return { ok: true, capability: cap };
}

/** Granted tools that match the intents, within the side-effect limit, cheapest effect first. */
export function matchCapabilities(agentId: string, intents: string[], maxSideEffect: SideEffect = "spend"): Capability[] {
  const want = new Set(intents);
  return grantsFor(agentId)
    .filter((c) => !c.neverFromAtlas && SIDE_RANK[c.sideEffect] <= SIDE_RANK[maxSideEffect] && c.intents.some((i) => want.has(i)))
    .sort((a, b) => SIDE_RANK[a.sideEffect] - SIDE_RANK[b.sideEffect] || a.id.localeCompare(b.id));
}

/** Which capability an execution path stands for, for checking tool selection after a run. */
export function capabilityForExecutor(executor: "n8n" | "github" | "manual", tier: 0 | 1 | 2): string | null {
  if (executor === "manual") return null;
  if (executor === "github") return "github.run_workflow";
  return tier === 1 ? "model.light" : tier === 2 ? "model.advanced" : "handoff.report";
}
