import { spend } from "../execution/policy";
import type { StoredTask } from "../tasks/types";
import { playbook } from "./playbooks";
import type { Incident, OpsFile } from "./types";

// Operational intelligence by counting, not by asking a model: patterns across recorded incidents,
// attempts and tasks, each with the record ids behind it. Recommendations are advice for Khaneil;
// nothing here changes an agent's instructions, policies or permissions.

export interface Insight {
  id: string;
  kind: "repeated_failure" | "unreliable_integration" | "retry_loop" | "model_usage" | "bottleneck" | "maintenance";
  title: string;
  detail: string;
  /** Incident, task or attempt ids the insight is based on. */
  refs: string[];
}

const DAY = 86_400_000;
const WEEK = 7 * DAY;

export function operationalInsights(f: Pick<OpsFile, "incidents" | "attempts">, tasks: readonly StoredTask[], now: number): Insight[] {
  const out: Insight[] = [];
  const recent = f.incidents.filter((i) => now - Date.parse(i.lastAt) <= WEEK);

  for (const i of recent.filter((x) => x.repeated || (x.reopened ?? 0) >= 2)) out.push({ id: `repeat:${i.id}`, kind: "repeated_failure", title: `Keeps failing: ${i.title}`, detail: `${i.count} reports${i.reopened ? `, came back ${i.reopened} time${i.reopened === 1 ? "" : "s"} after clearing` : ""}. Worth a root-cause fix rather than another recovery.`, refs: [i.id] });

  const byIntegration = new Map<string, Incident[]>();
  for (const i of recent) for (const e of i.evidence) if (e.system === "integration") byIntegration.set(e.resource, [...(byIntegration.get(e.resource) ?? []), i]);
  for (const [id, xs] of byIntegration) if (xs.length >= 2) out.push({ id: `integ:${id}`, kind: "unreliable_integration", title: `Unreliable connection: ${id}`, detail: `${xs.length} incidents this week. Check its key, quota or host.`, refs: xs.map((x) => x.id) });

  const byIncident = new Map<string, string[]>();
  for (const a of f.attempts) if (a.outcome !== "refused" && now - Date.parse(a.startedAt) <= WEEK) byIncident.set(a.incidentId, [...(byIncident.get(a.incidentId) ?? []), a.id]);
  for (const [incId, ids] of byIncident) {
    if (ids.length < 3) continue;
    const pb = playbook(f.attempts.find((a) => a.id === ids[0])?.playbookId ?? "");
    out.push({ id: `loop:${incId}`, kind: "retry_loop", title: `Retry loop: ${pb?.name ?? "recovery"}`, detail: `${ids.length} attempts on one incident this week. Recovery isn't addressing the cause.`, refs: [incId, ...ids] });
  }

  const heavy = tasks
    .filter((t) => now - Date.parse(t.updatedAt) <= WEEK)
    .map((t) => ({ t, s: spend(t) }))
    .filter((x) => x.s.billedUsd + x.s.estimatedUsd >= 2);
  if (heavy.length) out.push({ id: "models", kind: "model_usage", title: "Model spend concentrated in a few tasks", detail: heavy.slice(0, 3).map((x) => `${x.t.title}: $${(x.s.billedUsd + x.s.estimatedUsd).toFixed(2)}${x.s.estimatedUsd ? " (partly estimated)" : ""}`).join("; "), refs: heavy.map((x) => x.t.id) });

  const waiting = tasks.filter((t) => t.status === "awaiting_approval" && now - Date.parse(t.updatedAt) > DAY);
  if (waiting.length >= 2) out.push({ id: "approvals", kind: "bottleneck", title: `${waiting.length} approvals waiting over a day`, detail: "Steps behind them can't move. Decide them in the Task Center.", refs: waiting.map((t) => t.id) });

  const stalled = recent.filter((i) => i.types.includes("task.stalled"));
  if (stalled.length >= 2) out.push({ id: "stalls", kind: "maintenance", title: "Runs often pass their timeout", detail: `${stalled.length} stalled-run incidents this week. Check the executor's callbacks.`, refs: stalled.map((i) => i.id) });

  return out;
}

/** Recommendations for one incident, from the same counts. */
export function incidentRecommendations(i: Incident, insights: readonly Insight[], hasPlaybook: boolean): string[] {
  const r = insights.filter((x) => x.refs.includes(i.id)).map((x) => x.detail);
  if (!hasPlaybook) r.push("No approved playbook fits: investigate through the incident task.");
  if (i.types.includes("agent.unauthorized")) r.push("Review the agent's tool permissions; its policy wasn't changed.");
  if (i.types.some((t) => t.startsWith("budget"))) r.push("Decide whether to raise the budget; Atlas never raises it on its own.");
  return [...new Set(r)];
}
