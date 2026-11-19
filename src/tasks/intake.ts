import type { Agent } from "../catalog/types";
import type { RepoState } from "../github/types";
import { repoData } from "../lib/derive";
import { FAILED as N8N_FAILED, type N8nSnapshot } from "../n8n/types";
import { n8nWorkflowIds } from "../n8n/runs";
import type { AgentProfile } from "./registry";
import type { Router } from "./routing";
import type { TaskService } from "./store";
import type { Actor, TaskPriority, TaskSource, WorkflowRef } from "./types";

// Automated task creation. Events come from data Atlas already reads (n8n run summaries, GitHub
// runs of catalog agents); each one has a fixed key, so the same failure never makes two tasks.
// Switched off by default; Khaneil turns it on in the Task Center.

export interface IntakeEvent {
  key: string;
  source: TaskSource;
  title: string;
  description: string;
  priority: TaskPriority;
  agentId?: string;
  buildingId?: string;
  capability?: string;
  workflow?: WorkflowRef;
}

/** Failures older than this are history, not new work. */
const FRESH_MS = 24 * 3_600_000;
/** At most this many tasks from one pass, so a bad hour can't flood the list. */
export const MAX_PER_PASS = 10;

/** Latest failed run of each n8n workflow a catalog agent links to. */
export function n8nFailureEvents(snap: N8nSnapshot | null, agents: readonly Agent[], now = Date.now()): IntakeEvent[] {
  if (!snap || snap.state !== "ok") return [];
  const out: IntakeEvent[] = [];
  for (const a of agents) {
    if (a.status === "retired") continue;
    for (const id of n8nWorkflowIds(a)) {
      const wf = snap.workflows.find((w) => w.id === id);
      const run = wf?.runs[0];
      if (!wf || !run || !N8N_FAILED.has(run.status) || !run.startedAt || now - Date.parse(run.startedAt) > FRESH_MS) continue;
      out.push({
        key: `n8n-fail:${id}:${run.id}`,
        source: "n8n",
        title: `Investigate failed n8n run: ${wf.name}`,
        description: `n8n execution ${run.id} ended "${run.status}" at ${run.startedAt}.`,
        priority: "high",
        agentId: a.id,
        buildingId: a.projectId,
        workflow: { kind: "n8n", id, label: wf.name, url: `${snap.instance}/workflow/${id}/executions/${run.id}` },
      });
    }
  }
  return out;
}

/** Latest default-branch failure of each catalog agent's GitHub workflow. */
export function githubFailureEvents(agents: readonly Agent[], repos: Record<string, RepoState>, now = Date.now()): IntakeEvent[] {
  const out: IntakeEvent[] = [];
  for (const a of agents) {
    const file = a.observe?.githubWorkflow;
    if (!file || a.status === "retired") continue;
    const snap = repoData(repos[a.repository]);
    const run = snap?.workflowRuns?.[file]?.[0];
    if (!run || run.status !== "completed" || run.conclusion !== "failure" || run.id === undefined) continue;
    if (snap && run.branch !== snap.defaultBranch) continue;
    if (now - Date.parse(run.createdAt) > FRESH_MS) continue;
    out.push({
      key: `github-fail:${a.repository.toLowerCase()}:${run.id}:${run.attempt ?? 1}`,
      source: "github",
      title: `Investigate failed GitHub run: ${run.name}`,
      description: `${a.repository} · ${file} failed on ${run.branch}.`,
      priority: "high",
      agentId: a.id,
      buildingId: a.projectId,
      workflow: { kind: "github", id: file, label: `GitHub · ${file}`, repository: a.repository, url: run.url },
    });
  }
  return out;
}

/** Turns new events into queued tasks, routed by rule. Returns how many were made. */
export function intake(service: TaskService, events: readonly IntakeEvent[], profiles: readonly AgentProfile[], router: Router, actor: Actor): number {
  const seen = new Set(service.repo.list().map((t) => t.intakeKey).filter(Boolean));
  let made = 0;
  for (const e of events) {
    if (made >= MAX_PER_PASS) break;
    if (seen.has(e.key)) continue;
    const route = router.route({ title: e.title, description: e.description, source: e.source, buildingId: e.buildingId, capability: e.capability, agentId: e.agentId }, profiles);
    const agent = route ? profiles.find((p) => p.id === route.agentId) : undefined;
    const r = service.create(
      {
        title: e.title,
        description: route ? `${e.description}\n\nRouted: ${route.reason}` : e.description,
        priority: e.priority,
        source: e.source,
        agentId: agent?.id,
        agentName: agent?.name,
        buildingId: route?.buildingId ?? e.buildingId,
        buildingName: agent?.buildingName,
        workflow: e.workflow,
        intakeKey: e.key,
      },
      actor,
    );
    if (r.ok) {
      made++;
      seen.add(e.key);
    }
  }
  return made;
}
