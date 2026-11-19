import type { NodeStatus, WorkflowDefinition } from "../workflows/types";
import { NODE_CATEGORY } from "./live";
import type { AgentOutput, OutputType } from "./types";

// Simulated outputs for the Benjaire launch template: fixed, illustrative samples that show what
// each step would hand over. They name no real customer, sale, competitor or source, every one is
// labelled simulated, and they're keyed to a run id no live run can have, so they never mix with
// live records. Nothing here calls a service.

export const SIM_RUN_PREFIX = "simulation:";
export const simRunId = (definitionId: string) => `${SIM_RUN_PREFIX}${definitionId}`;
const SIM_AT = "2026-01-01T09:00:00.000Z";
const NOTE = "Illustrative sample, not research.";

interface Sample {
  key: string;
  type: OutputType;
  title: string;
  summary?: string;
  data: unknown;
}

const SAMPLES: Record<string, Sample[]> = {
  intake: [
    { key: "brief", type: "markdown", title: "Goal and delegation", summary: "8 steps delegated", data: "### Goal\nResearch, validate, develop and launch an AI automation product for Benjaire.\n\n### Delegated to\n- Market, customer and competitor research (in parallel)\n- Opportunity scoring, then Khaneil's viability decision\n- Product brief and development plan\n- Approvals before development and launch\n\n" + `_${NOTE}_` },
    { key: "envelope", type: "json", title: "Handoff envelope (shape)", data: { envelopeVersion: 1, runId: "simulation", nodeId: "market-research", inputSchema: "goal-intake/1", outputSchema: "market-research/1", inputs: { intake: { schema: "goal-intake/1", fields: { goal: "…", budgetUsd: 5, agents: ["…"] } } } } },
  ],
  "market-research": [
    { key: "summary", type: "markdown", title: "Market research summary", summary: "3 sample ideas", data: `### Idea long list\n- Invoice follow-up assistant for freelancers\n- Lead intake triage for small agencies\n- Appointment no-show follow-up for clinics\n\n### Demand signals\n- In a live run each signal carries a dated link. None are shown here.\n\n_${NOTE}_` },
    { key: "opps", type: "table", title: "Opportunity summaries", data: { columns: ["Idea", "Who it helps", "Signal (live runs only)"], rows: [["Invoice follow-up assistant", "Freelancers", "—"], ["Lead intake triage", "Small agencies", "—"], ["No-show follow-up", "Clinics", "—"]] } },
  ],
  "customer-research": [
    { key: "pains", type: "table", title: "Customer pain-point analysis", summary: "3 sample segments", data: { columns: ["Segment", "Need", "Pain-point category"], rows: [["Freelancers", "Get paid on time", "Cash flow"], ["Small agencies", "Answer leads fast", "Response time"], ["Clinics", "Fewer missed bookings", "Lost revenue"]] } },
  ],
  "competitor-analysis": [
    { key: "compare", type: "table", title: "Competitor comparison", data: { columns: ["Competitor", "Covers", "Gap to differentiate on"], rows: [["Competitor A (sample)", "Invoicing with reminders", "No tone matching per client"], ["Competitor B (sample)", "Lead forms", "No triage or routing"], ["Competitor C (sample)", "Booking reminders", "No follow-up after a no-show"]] } },
  ],
  scoring: [
    { key: "chart", type: "chart", title: "Opportunity scorecard", summary: "Top sample idea: Lead intake triage", data: { series: [{ label: "Lead intake triage", value: 78 }, { label: "Invoice follow-up assistant", value: 71 }, { label: "No-show follow-up", value: 64 }], max: 100, unit: "sample score" } },
    { key: "rationale", type: "markdown", title: "Ranked opportunities and rationale", data: `1. **Lead intake triage**: highest fit with existing Benjaire automations.\n2. **Invoice follow-up assistant**: clear need, crowded space.\n3. **No-show follow-up**: needs calendar integrations Atlas doesn't have.\n\nCriteria: demand, reach cost, build effort, fit.\n\n_${NOTE} Scores are sample numbers._` },
  ],
  viability: [{ key: "decision", type: "text", title: "Viability decision", data: { text: "Go ahead with the top idea (simulated decision; in a live run only Khaneil decides)." } }],
  parked: [{ key: "parked", type: "text", title: "Idea parked", data: { text: "Research kept for the next Product Lab run (simulated)." } }],
  brief: [
    { key: "doc", type: "document", title: "Product brief", data: { sections: [{ heading: "Target customer", body: "Small agencies that lose leads to slow replies." }, { heading: "MVP scope", body: "- Read new leads from a form\n- Sort them by urgency\n- Draft a reply for a person to send" }, { heading: "Positioning", body: "Answer every lead the same day, without hiring." }, { heading: "Note", body: NOTE }] } },
  ],
  planning: [
    { key: "plan", type: "document", title: "Development plan", data: { sections: [{ heading: "Plan", body: "- Week 1: intake and sorting\n- Week 2: reply drafts\n- Week 3: pilot with one agency" }, { heading: "Implementation dependencies", body: "- A form or inbox connector\n- A reviewed reply template" }, { heading: "Approval requirements", body: "- Khaneil approves the scope before any repository change\n- Khaneil approves the launch before prices or customer messages" }, { heading: "Note", body: NOTE }] } },
  ],
  "approve-scope": [{ key: "approval", type: "text", title: "Scope approval", data: { text: "Approved (simulated). In a live run only Khaneil can approve, in the Task Center." } }],
  develop: [{ key: "build", type: "table", title: "Build and test results", data: { columns: ["Check", "Result"], rows: [["Build", "passed"], ["Unit tests", "passed"]] } }],
  quality: [
    { key: "checks", type: "table", title: "Quality-check results", summary: "3 passed, 1 failed (sample)", data: { columns: ["Check", "Result"], rows: [["Unit tests", "Passed"], ["Accessibility", "Passed"], ["Reply drafts reviewed by a person", "Passed"], ["Load test", "Failed"]] } },
    { key: "log", type: "code", title: "Test log (sample)", data: { language: "text", code: "✓ intake sorts by urgency (12 ms)\n✓ draft never sends on its own (4 ms)\n✓ form labels are readable (9 ms)\n✗ 200 leads in a minute: timed out\n\n3 passed, 1 failed" } },
    { key: "ready", type: "text", title: "Release readiness", data: { text: "Not ready: one failed check must be fixed or waived by Khaneil before launch (simulated)." } },
  ],
  "approve-launch": [{ key: "approval", type: "text", title: "Launch approval", data: { text: "Approved (simulated). A live launch needs Khaneil's approval for production, prices and customer messages." } }],
  publish: [{ key: "listing", type: "text", title: "Marketplace publication", data: { text: "No product, price or listing is created in a simulation." } }],
  monitor: [
    { key: "summary", type: "markdown", title: "Launch summary", data: `### What a live run reports here\n- Verified business outcomes, with their source\n- Product performance from the monitor's alerts\n- Revenue only from a connected payments source\n\nNo sales, customers or revenue are shown in a simulation.` },
  ],
};

/**
 * The simulated outputs visible at the current simulation step: complete for finished steps, a
 * working card for steps in progress, and a "not set up" card for unconfigured steps unless a
 * person stands in for them.
 */
export function simulatedOutputs(def: WorkflowDefinition, status: ReadonlyMap<string, NodeStatus>, opts: { standIn: boolean; startedNodes: ReadonlySet<string>; completedNodes: ReadonlySet<string> }): AgentOutput[] {
  const runId = simRunId(def.id);
  const res: AgentOutput[] = [];
  for (const n of def.nodes) {
    const s = status.get(n.id);
    const started = opts.startedNodes.has(n.id);
    const common = { workflowRunId: runId, taskId: `${runId}:${n.id}`, agentId: n.agentId ?? "khaneil", nodeId: n.id, createdAt: SIM_AT, verificationStatus: "simulated" as const, mode: "simulation" as const, attempt: 1, latest: true, category: NODE_CATEGORY[n.id] ?? "research" };
    const done = s === "completed" || (!!n.unconfigured && opts.standIn && opts.completedNodes.has(n.id));
    if (n.unconfigured && !opts.standIn && started) {
      res.push({ ...common, id: `${runId}:${n.id}:unconfigured`, type: "error", title: `${n.title}: not set up`, structuredData: { message: n.unconfigured }, state: "unconfigured", category: "errors" });
      continue;
    }
    if (!done) {
      if (s === "running" || s === "awaiting_approval") res.push({ ...common, id: `${runId}:${n.id}:pending`, type: "text", title: `${n.title}: in progress`, structuredData: { text: s === "awaiting_approval" ? "Waiting for Khaneil (simulated)." : "Working (simulated)." }, state: "loading" });
      continue;
    }
    for (const x of SAMPLES[n.id] ?? []) res.push({ ...common, id: `${runId}:${n.id}:${x.key}`, type: x.type, title: x.title, summary: x.summary, structuredData: x.data, state: "complete", category: x.key === "log" || x.key === "checks" ? "engineering" : common.category });
  }
  return res;
}
