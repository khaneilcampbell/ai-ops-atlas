import type { MemoryRecord } from "./types";

// Memory kept in the repository: Khaneil's standing policies and facts the code itself enforces.
// These records are version-controlled (a change is a pull request, a rollback is a revert), are
// marked verified because each one points at the file that states or enforces it, and never
// expire. Only what is already public in this repository goes here; nothing private.

const AT = "2026-11-15T00:00:00.000Z";
const REPO = { kind: "system", id: "repository", name: "Atlas repository" } as const;
const WF = "benjaire-ai-product-launch";

function seed(id: string, r: Omit<MemoryRecord, "id" | "createdAt" | "updatedAt" | "createdBy" | "verification" | "verifiedBy" | "verifiedAt" | "expiry" | "seeded" | "sensitivity"> & { sensitivity?: MemoryRecord["sensitivity"] }): MemoryRecord {
  return { sensitivity: "internal", ...r, id: `seed:${id}`, createdAt: AT, updatedAt: AT, createdBy: REPO, verification: "verified", verifiedBy: "Atlas repository", verifiedAt: AT, expiry: { policy: "none" }, seeded: true };
}

export const SEED_MEMORY: readonly MemoryRecord[] = [
  seed("policy-approval-gates", {
    category: "human_approved",
    scope: { project: "global" },
    title: "Human approval before development, spending, publication or deployment",
    content: "Product development, any spending, publication and production deployment each need Khaneil's approval for that run. An agent, a workflow or Atlas itself can never approve.",
    tags: ["always", "approval", "policy", "spend", "publish", "deploy", "develop"],
    source: { kind: "repository", ref: "src/tasks/lifecycle.ts" },
  }),
  seed("policy-no-self-change", {
    category: "human_approved",
    scope: { project: "global" },
    title: "Agents never change their own permissions, prompts or deployments",
    content: "Agents may recommend prompt, knowledge, workflow and validation improvements. They never change permissions, security rules, production prompts, deployment settings or approval requirements; Khaneil reviews every proposal and applies it as a new version.",
    tags: ["always", "policy", "permissions", "prompt", "improvement"],
    source: { kind: "repository", ref: "CLAUDE.md" },
  }),
  seed("policy-publish-never-from-atlas", {
    category: "human_approved",
    scope: { project: "global" },
    title: "Approve and Publish never start from Atlas",
    content: "Only research and planning steps can be sent to the n8n step runner. Approve and Publish runs only when Khaneil submits its approval form.",
    tags: ["policy", "publish", "n8n", "bridge"],
    source: { kind: "repository", ref: "src/execution/n8nBridge.ts" },
  }),
  seed("policy-model-use", {
    category: "human_approved",
    scope: { project: "global" },
    title: "Keep model calls few: Haiku classifies, Sonnet summarises and reviews, Opus writes code",
    content: "No continuous agent loops. Plain code handles validation, routing and status; a lightweight model handles classification and extraction; an advanced model is kept for research, planning and root-cause work, and the frontier model for writing code.",
    tags: ["always", "policy", "model", "cost", "routing"],
    source: { kind: "repository", ref: "src/usage/insights.ts" },
  }),
  seed("benjaire-scorecard", {
    category: "project_knowledge",
    scope: { project: "benjaire-site", workflowId: WF },
    title: "Benjaire product scorecard and brief rules",
    content: "Ideas are scored 1 to 5 on demand, gap, fit, margin, validate and synergy; totals must add up and the top pick must have the highest total. Every source must be a link. Estimates are labelled as estimates.",
    tags: ["scoring", "scorecard", "brief", "research", "product"],
    source: { kind: "repository", ref: "docs/product-lab.md" },
  }),
  seed("benjaire-research-limits", {
    category: "project_knowledge",
    scope: { project: "benjaire-site", workflowId: WF },
    title: "Product Lab research skills and limits",
    content: "Market research lists 6 to 10 ideas with dated, linked demand signals; at most 5 web searches a run. Customer research gives personas, pains and cheap reach channels. Competitor analysis lists who sells each idea, prices and review complaints. Ideas needing heavy inventory, regulatory approval or patents are dropped.",
    tags: ["research", "market", "customer", "competitor", "search", "product"],
    source: { kind: "repository", ref: "catalog/benjaire-com.yaml" },
  }),
  seed("benjaire-handoff-schemas", {
    category: "project_knowledge",
    scope: { project: "benjaire-site", workflowId: WF },
    title: "Benjaire launch handoff schemas",
    content: "Each step hands on a small fixed schema (market-research/1, customer-research/1, competitor-analysis/1, opportunity-scores/1, product-brief/1, product-plan/1). Unknown fields are refused; documents travel as https artifact links.",
    tags: ["handoff", "schema", "artifact", "research", "scoring", "brief", "planning"],
    source: { kind: "repository", ref: "src/execution/handoff.ts" },
  }),
  seed("ops-n8n-read-only", {
    category: "operational",
    scope: { project: "global" },
    title: "Atlas's n8n key is read-only",
    content: "Atlas can read n8n workflows and executions but cannot start the Product Lab or edit prompts. Only the restricted Atlas Step Runner accepts steps, six step types and at most 20 sends a day.",
    tags: ["n8n", "limitation", "tool", "bridge", "prompt"],
    source: { kind: "repository", ref: "src/execution/n8nBridge.ts" },
  }),
  seed("ops-reuse-research", {
    category: "operational",
    scope: { project: "global", workflowId: WF },
    title: "Reuse validated research for 30 days",
    content: "A validated market, customer or competitor research output from an earlier run of the same workflow is reused for 30 days instead of running the research again.",
    tags: ["research", "reuse", "cost", "strategy"],
    source: { kind: "repository", ref: "src/execution/policy.ts" },
  }),
];
