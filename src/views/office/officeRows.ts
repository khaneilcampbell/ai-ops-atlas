import type { Agent, Project } from "../../catalog/types";
import type { Proposal } from "../../approvals/proposals";
import { buildRegistry, type IntelSource, type RegistryEntry } from "../../registry/registry";
import type { RepoState } from "../../github/types";
import type { ExecutionRecord } from "../../registry/types";
import { ACTION_AGENTS, actionExecutions, runtimeFor, type ActionData, type Runtime } from "./model";

/** One worker's desk data: its registry entry, its runtime state from verified data, its run history. */
export interface OfficeRow {
  entry: RegistryEntry;
  runtime: Runtime;
  history: ExecutionRecord[];
}

/**
 * Every worker's runtime state, from the same verified sources the office inspector uses: the
 * registry's telemetry, the desktop app's action audit log, and proposals waiting for KC. Shared
 * by the office (one building) and the map's Inside view (every building in view), so a desk
 * never shows a different state on the map than it does inside.
 */
export function officeRows(projects: Project[], agents: Agent[], repos: Record<string, RepoState>, intel: IntelSource | null, actions: ActionData, pending: Proposal[]): Map<string, OfficeRow> {
  const entries = buildRegistry({ projects, agents }, repos, intel);
  return new Map(
    entries.map((entry) => {
      const a = agents.find((x) => x.id === entry.profile.id)!;
      const action = ACTION_AGENTS[a.id];
      return [a.id, { entry, runtime: runtimeFor(a, entry.telemetry, actions, pending.filter((p) => p.agentId === a.id).length), history: action ? actionExecutions(action, actions.audit) : entry.telemetry.executions }];
    }),
  );
}
