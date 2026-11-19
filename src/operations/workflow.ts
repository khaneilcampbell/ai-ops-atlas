import type { AgentOutput } from "../outputs/types";
import type { ExecutionEvent, Goal, NodeStatus, WorkflowDefinition } from "../workflows/types";
import { playbook } from "./playbooks";
import { IDENTITY_LABEL, INCIDENT_STATE_LABEL, type Incident, type OpsFile, type RecoveryAttempt } from "./types";

// Incidents in Workflow Intelligence and the Agent Output Studio. Each incident is shown as one
// fixed recovery workflow (detect, correlate, assign, approval gate, recover, verify, outcome),
// so the existing canvas, timeline, simulation and Output Studio display it. Live status comes
// only from the incident's own records; the simulation plays the same template and says so.

export const INCIDENT_PREFIX = "incident:";
const AT = "2026-11-17T00:00:00.000Z";

export function incidentDefinition(i: Pick<Incident, "id" | "title" | "systems">, owner: string): WorkflowDefinition {
  return {
    id: `${INCIDENT_PREFIX}${i.id}`,
    version: 1,
    name: `Incident · ${i.title}`,
    updatedAt: AT,
    nodes: [
      { id: "detect", kind: "automation", stage: 1, title: "Detect and verify event", summary: "A normalized event passed schema validation and source trust.", agentId: "atlas-health-monitor", inputs: ["Source records"], outputs: ["Verified events"], execution: { kind: "owned", note: "Atlas rules over records it already reads; no model." } },
      { id: "correlate", kind: "automation", stage: 2, title: "Group, deduplicate and rate", summary: "Repeats are dropped; related reports from other systems join the same incident; severity comes from a fixed table.", agentId: "atlas-health-monitor", inputs: ["Verified events"], outputs: ["Incident"], execution: { kind: "owned", note: "Deterministic rules; no model." } },
      { id: "assign", kind: "agent", stage: 3, title: "Assign incident task", summary: "A Task Center task for the owning agent when the autonomy level allows, otherwise a recommendation for Khaneil.", agentId: owner, inputs: ["Incident"], outputs: ["Incident task"], execution: { kind: "manual", note: "Created by Khaneil at level 0 and 1; by Atlas at level 2 and 3 for high and critical incidents." } },
      { id: "approval", kind: "approval", stage: 4, title: "Approval gate", summary: "Atlas runs a playbook on its own only under an enabled policy at level 3. Otherwise Khaneil starts it.", inputs: ["Incident task"], outputs: ["Go ahead"], execution: { kind: "manual", note: "Khaneil, or an enabled level 3 policy." }, approval: { categories: [], reason: "Recovery runs only with Khaneil's go ahead or an enabled policy at level 3." } },
      { id: "recover", kind: "automation", stage: 5, title: "Run recovery playbook", summary: "One approved, read-only playbook with bounded retries and backoff.", agentId: "atlas-health-monitor", inputs: ["Go ahead"], outputs: ["Recovery log"], execution: { kind: "owned", note: "Approved playbooks only; nothing destructive." } },
      { id: "verify", kind: "automation", stage: 6, title: "Verify the fix", summary: "Passed only when the source answers again and no longer reports the problem.", agentId: "atlas-health-monitor", inputs: ["Recovery log"], outputs: ["Verification"], execution: { kind: "owned", note: "Judged from the next read of the source." } },
      { id: "outcome", kind: "outcome", stage: 7, title: "Incident outcome", summary: "Resolved and verified, or escalated to Khaneil.", inputs: ["Verification"], outputs: ["Outcome"], execution: { kind: "none", note: "Recorded by Atlas." } },
    ],
    edges: [
      { id: "e1", from: "detect", to: "correlate" },
      { id: "e2", from: "correlate", to: "assign" },
      { id: "e3", from: "assign", to: "approval" },
      { id: "e4", from: "approval", to: "recover" },
      { id: "e5", from: "recover", to: "verify" },
      { id: "e6", from: "verify", to: "outcome" },
    ],
  };
}

/** Recent incidents (newest 10) as Workflow Intelligence goals and definitions. */
export function incidentWorkflows(f: Pick<OpsFile, "incidents">, ownerOf: (i: Incident) => string): { goals: Goal[]; definitions: Record<string, WorkflowDefinition> } {
  const recent = [...f.incidents].sort((a, b) => b.lastAt.localeCompare(a.lastAt)).slice(0, 10);
  const goals = recent.map((i) => ({ id: `${INCIDENT_PREFIX}${i.id}`, name: `Incident · ${i.title}`.slice(0, 80), objective: i.title, expectedOutcome: "The source reports healthy again and the fix is verified, or Khaneil has it.", definitionId: `${INCIDENT_PREFIX}${i.id}` }));
  return { goals, definitions: Object.fromEntries(recent.map((i) => [`${INCIDENT_PREFIX}${i.id}`, incidentDefinition(i, ownerOf(i))])) };
}

export const incidentOf = (f: Pick<OpsFile, "incidents">, goalId: string) => (goalId.startsWith(INCIDENT_PREFIX) ? f.incidents.find((i) => `${INCIDENT_PREFIX}${i.id}` === goalId) : undefined);

const attemptsOf = (f: Pick<OpsFile, "attempts">, i: Incident) => f.attempts.filter((a) => a.incidentId === i.id);

/** Node status from the incident's own records. Nothing is inferred beyond them. */
export function incidentStatus(i: Incident, f: Pick<OpsFile, "attempts">): Map<string, NodeStatus> {
  const tries = attemptsOf(f, i).filter((a) => a.outcome !== "refused");
  const last = tries[tries.length - 1];
  const verifying = last?.verification?.state;
  const closed = i.state === "resolved" || i.state === "dismissed";
  const recover: NodeStatus = !last ? (closed ? "skipped" : "not_started") : last.outcome === "dispatched" ? "running" : last.outcome === "succeeded" ? "completed" : last.outcome === "unknown" ? "blocked" : "failed";
  const verify: NodeStatus = verifying === "passed" ? "completed" : verifying === "failed" ? "failed" : verifying === "pending" ? "running" : i.verified ? "completed" : "not_started";
  return new Map<string, NodeStatus>([
    ["detect", "completed"],
    ["correlate", "completed"],
    ["assign", i.incidentTaskId ? "completed" : closed ? "skipped" : "awaiting_approval"],
    ["approval", last ? "completed" : closed ? "skipped" : "awaiting_approval"],
    ["recover", recover],
    ["verify", verify],
    ["outcome", i.state === "resolved" ? "completed" : i.state === "escalated" ? "failed" : i.state === "dismissed" ? "cancelled" : "not_started"],
  ]);
}

/** The incident's timeline from its evidence and attempts. */
export function incidentEvents(i: Incident, f: Pick<OpsFile, "attempts">): ExecutionEvent[] {
  const ev: ExecutionEvent[] = [];
  const add = (nodeId: string, at: string, type: ExecutionEvent["type"], text: string, actor?: string) => ev.push({ id: `${i.id}:${ev.length}`, nodeId, at, type, text, simulated: false, ...(actor ? { actor } : {}) });
  for (const e of i.evidence) add("detect", e.at, "completed", `${e.system}: ${e.detail}`, IDENTITY_LABEL[e.identity]);
  add("correlate", i.firstAt, "completed", `Incident opened, severity ${i.severity}${i.count > 1 ? `, ${i.count} reports` : ""}${i.repeated ? ", repeating" : ""}.`, "Atlas");
  for (const a of attemptsOf(f, i)) {
    const pb = playbook(a.playbookId)?.name ?? a.playbookId;
    if (a.outcome === "refused") continue;
    add("approval", a.startedAt, "approved", a.actor.kind === "person" ? `${a.actor.name} started ${pb}.` : `Enabled level 3 policy allowed ${pb}.`, a.actor.name);
    add("recover", a.startedAt, "started", `${pb} · attempt ${a.number}`, a.actor.name);
    if (a.finishedAt) add("recover", a.finishedAt, a.outcome === "succeeded" ? "completed" : a.outcome === "unknown" ? "waiting" : "failed", a.detail, a.actor.name);
    if (a.verification?.at) add("verify", a.verification.at, a.verification.state === "passed" ? "completed" : "failed", a.verification.detail, "Atlas");
  }
  if (i.escalation) add("outcome", i.escalation.at, "failed", `Escalated: ${i.escalation.reason}`, "Atlas");
  if (i.resolvedAt) add("outcome", i.resolvedAt, "completed", i.resolution ?? "Resolved.", "Atlas");
  return ev.sort((a, b) => a.at.localeCompare(b.at));
}

const out = (i: Incident, nodeId: string, partial: Partial<AgentOutput> & Pick<AgentOutput, "type" | "title" | "category" | "state" | "verificationStatus">, agentId = "atlas-health-monitor"): AgentOutput => ({
  id: `${i.id}:${nodeId}:${partial.title}`,
  workflowRunId: `${INCIDENT_PREFIX}${i.id}`,
  taskId: i.incidentTaskId ?? "",
  agentId,
  nodeId,
  createdAt: i.lastAt,
  mode: "live",
  attempt: null,
  latest: true,
  ...partial,
});

/**
 * Output Studio cards for an incident: summary, diagnostics, recovery log, verification and
 * recommendations. "Verified" only for a verification Atlas actually observed passing.
 */
export function incidentOutputs(i: Incident, f: Pick<OpsFile, "attempts">, recommendations: readonly string[]): AgentOutput[] {
  const tries = attemptsOf(f, i);
  const list: AgentOutput[] = [
    out(i, "correlate", { type: "document", title: "Incident summary", category: "documents", state: "complete", verificationStatus: "unverified", summary: `${INCIDENT_STATE_LABEL[i.state]} · ${i.severity}`, structuredData: { sections: [{ heading: "What happened", body: i.title }, { heading: "Seen", body: `${i.count} report${i.count === 1 ? "" : "s"} from ${i.systems.join(", ")} between ${i.firstAt} and ${i.lastAt}.` }, ...(i.impact.length ? [{ heading: "Affects", body: i.impact.join("; ") }] : [])] } }),
    out(i, "detect", { type: "table", title: "Diagnostic findings", category: "analytics", state: "complete", verificationStatus: "unverified", summary: "Evidence from each source, as reported", structuredData: { columns: ["System", "Source check", "Resource", "Finding"], rows: i.evidence.map((e) => [e.system, IDENTITY_LABEL[e.identity], e.resource, e.detail]) }, sourceRefs: i.evidence.flatMap((e) => (e.url ? [e.url] : [])) }),
  ];
  if (tries.length) list.push(out(i, "recover", { type: "table", title: "Recovery log", category: "engineering", state: tries.some((a) => a.outcome === "dispatched") ? "loading" : "complete", verificationStatus: "unverified", structuredData: { columns: ["#", "Playbook", "By", "Outcome", "Detail"], rows: tries.map((a: RecoveryAttempt) => [a.number, playbook(a.playbookId)?.name ?? a.playbookId, a.actor.name, a.outcome, a.detail]) } }));
  const v = [...tries].reverse().find((a) => a.verification);
  if (v?.verification || i.verified) {
    const passed = v?.verification?.state === "passed" || (!!i.verified && !v);
    list.push(out(i, "verify", { type: "text", title: "Verification result", category: passed ? "decisions" : "errors", state: v?.verification?.state === "pending" ? "loading" : passed ? "complete" : "failed", verificationStatus: passed ? "verified" : "unverified", structuredData: v?.verification?.detail ?? i.resolution ?? "", summary: passed ? "Observed healthy after the fix" : v?.verification?.state === "pending" ? "Waiting for the source to answer again" : "Still reported after the fix" }));
  }
  if (recommendations.length) list.push(out(i, "outcome", { type: "markdown", title: "Recommendations", category: "decisions", state: "complete", verificationStatus: "unverified", structuredData: recommendations.map((r) => `- ${r}`).join("\n") }, "agent-operations-lead"));
  if (i.escalation) list.push(out(i, "outcome", { type: "error", title: "Escalated to Khaneil", category: "errors", state: "failed", verificationStatus: "unverified", structuredData: { message: i.escalation.reason } }));
  return list;
}
