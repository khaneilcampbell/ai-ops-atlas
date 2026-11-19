import type { Goal, NodeStatus, WorkflowDefinition } from "../workflows/types";
import { NODE_STATUS_LABEL } from "../workflows/types";
import type { AgentOutput, VerificationStatus } from "./types";

// The consolidated workflow report: assembled deterministically from the outputs already shown.
// No model call. Each line keeps its verification label, so an unverified or simulated output is
// never presented as verified.

export interface ReportLine {
  text: string;
  nodeId: string;
  verification: VerificationStatus;
}

export interface WorkflowReport {
  mode: "live" | "simulation";
  goal: string;
  objective: string;
  agents: { id: string; name: string }[];
  completedStages: number[];
  findings: ReportLine[];
  recommendation: ReportLine[];
  evidence: { ref: string; nodeId: string; verification: VerificationStatus }[];
  decisions: ReportLine[];
  deliverables: ReportLine[];
  failures: ReportLine[];
  nextActions: string[];
  counts: Record<VerificationStatus, number>;
}

const line = (o: AgentOutput, text = o.summary ? `${o.title}: ${o.summary}` : o.title): ReportLine => ({ text, nodeId: o.nodeId, verification: o.verificationStatus });

export function assembleReport(goal: Goal, def: WorkflowDefinition, outputs: readonly AgentOutput[], status: ReadonlyMap<string, NodeStatus>, names: (id: string) => string, mode: "live" | "simulation"): WorkflowReport {
  const latest = outputs.filter((o) => o.latest);
  const ok = latest.filter((o) => o.state === "complete" && o.category !== "errors");
  const stages = [...new Set(def.nodes.map((n) => n.stage))].sort((a, b) => a - b);
  const counted = (n: (typeof def.nodes)[number]) => n.kind !== "outcome" && status.get(n.id) !== "skipped";
  const completedStages = stages.filter((st) => {
    const ns = def.nodes.filter((n) => n.stage === st && counted(n));
    return ns.length > 0 && ns.every((n) => status.get(n.id) === "completed");
  });
  const agentIds = [...new Set(def.nodes.map((n) => n.agentId).filter((x): x is string => !!x))];
  const evidence = new Map<string, { ref: string; nodeId: string; verification: VerificationStatus }>();
  for (const o of ok) for (const ref of o.sourceRefs ?? []) if (!evidence.has(ref)) evidence.set(ref, { ref, nodeId: o.nodeId, verification: o.verificationStatus });
  for (const o of ok) if (o.artifact && !evidence.has(o.artifact.url)) evidence.set(o.artifact.url, { ref: o.artifact.url, nodeId: o.nodeId, verification: o.verificationStatus });

  return {
    mode,
    goal: goal.name,
    objective: goal.objective,
    agents: agentIds.map((id) => ({ id, name: names(def.nodes.find((n) => n.agentId === id)!.id) })),
    completedStages,
    findings: ok.filter((o) => o.category === "research" || o.category === "analytics").map((o) => line(o)),
    recommendation: ok.filter((o) => o.nodeId === "scoring" || o.nodeId === "viability").filter((o) => o.summary || o.type === "text").map((o) => line(o, o.summary ?? textOf(o) ?? o.title)),
    evidence: [...evidence.values()],
    decisions: ok.filter((o) => o.category === "decisions").map((o) => line(o, textOf(o) ? `${o.title}: ${textOf(o)}` : o.title)),
    deliverables: ok.filter((o) => o.category === "documents" || o.category === "engineering").filter((o) => !o.id.endsWith(":log")).map((o) => line(o)),
    failures: latest.filter((o) => o.category === "errors" || o.state === "missing" || o.state === "unconfigured" || o.state === "failed").map((o) => line(o, `${o.title}${textOf(o) ? `: ${textOf(o)}` : ""}`)),
    nextActions: def.nodes
      .filter((n) => n.kind !== "outcome")
      .filter((n) => !["completed", "skipped"].includes(status.get(n.id) ?? "not_started"))
      .slice(0, 6)
      .map((n) => `${n.title} (${NODE_STATUS_LABEL[status.get(n.id) ?? "not_started"].toLowerCase()})`),
    counts: {
      verified: latest.filter((o) => o.verificationStatus === "verified").length,
      unverified: latest.filter((o) => o.verificationStatus === "unverified").length,
      simulated: latest.filter((o) => o.verificationStatus === "simulated").length,
    },
  };
}

function textOf(o: AgentOutput): string | undefined {
  const d = o.structuredData as { text?: unknown; message?: unknown } | undefined;
  const t = typeof d?.text === "string" ? d.text : typeof d?.message === "string" ? d.message : undefined;
  return t?.split("\n")[0];
}
