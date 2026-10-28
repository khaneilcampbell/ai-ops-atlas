import type { Status } from "../catalog/types";
import type { Runtime, RuntimeState } from "../views/office/model";
import type { RegistryEntry } from "./registry";

/**
 * The Active agents tab in Mission Control. "Switched on" is what the manifest says (status
 * active, or active but flagged for attention); "running now" is only ever an observed run.
 * The two are kept apart so a switched-on agent is never shown as working without evidence.
 */

export interface ActiveRow {
  entry: RegistryEntry;
  runtime: Runtime;
  /** The manifest marks it active (or active and needing attention). */
  switchedOn: boolean;
}

export type ActiveScope = "on" | "all";

const SWITCHED_ON: Status[] = ["active", "attention"];
export const isSwitchedOn = (s: Status) => SWITCHED_ON.includes(s);

/** Most pressing first: what is running, then what is blocked on KC, then what failed. */
const ORDER: Record<RuntimeState, number> = {
  working: 0,
  awaiting: 1,
  failed: 2,
  idle: 3,
  unknown: 4,
  offline: 5,
};

/**
 * Rows for the tab. Scope "on" keeps switched-on agents plus any agent observed running or
 * waiting for approval, even when its manifest says otherwise, so live work is never hidden.
 */
export function activeRows(entries: RegistryEntry[], runtimes: Map<string, Runtime>, scope: ActiveScope): ActiveRow[] {
  const rows: ActiveRow[] = [];
  for (const entry of entries) {
    const runtime = runtimes.get(entry.profile.id);
    if (!runtime) continue;
    const switchedOn = isSwitchedOn(entry.status);
    const live = runtime.state === "working" || runtime.state === "awaiting";
    if (scope === "on" && !switchedOn && !live) continue;
    rows.push({ entry, runtime, switchedOn });
  }
  const last = (r: ActiveRow) => r.entry.telemetry.lastAnyRun?.at ?? "";
  return rows.sort(
    (a, b) =>
      ORDER[a.runtime.state] - ORDER[b.runtime.state] || Number(b.switchedOn) - Number(a.switchedOn) || last(b).localeCompare(last(a)) || a.entry.profile.title.localeCompare(b.entry.profile.title),
  );
}

export interface ActiveSummary {
  switchedOn: number;
  running: number;
  awaiting: number;
  failed: number;
  /** Switched on, but no live source is declared, so nothing can say whether it runs. */
  unobserved: number;
}

export function activeSummary(rows: ActiveRow[]): ActiveSummary {
  const on = rows.filter((r) => r.switchedOn);
  return {
    switchedOn: on.length,
    running: rows.filter((r) => r.runtime.state === "working").length,
    awaiting: rows.filter((r) => r.runtime.state === "awaiting").length,
    failed: rows.filter((r) => r.runtime.state === "failed").length,
    unobserved: on.filter((r) => r.runtime.source === null).length,
  };
}

/** Cost as far as a source can tell: observed spend first, then the documented budget. */
export function costOf(e: RegistryEntry): { value: string; basis: "observed" | "documented" } | null {
  const t = e.telemetry;
  if (t.monthSpendUsd !== null) {
    const budget = t.monthBudgetUsd ? ` of $${t.monthBudgetUsd.toFixed(0)} budget` : "";
    return {
      value: `$${t.monthSpendUsd.toFixed(2)} this month${budget}`,
      basis: "observed",
    };
  }
  const doc = e.profile.cost.budget ?? e.profile.cost.notes;
  return doc ? { value: doc, basis: "documented" } : null;
}

/** When the agent runs, as documented. Free text in the manifests, so no next run is computed. */
export function scheduleOf(e: RegistryEntry): string | null {
  return e.profile.execution.schedule ?? e.profile.execution.trigger;
}

/** A doc path from a manifest: full URLs as they are, repository paths on the default branch. */
export function docUrl(path: string, repository: string, branch: string): string {
  return /^https:\/\//.test(path) ? path : `https://github.com/${repository}/blob/${branch}/${path.replace(/^\.?\//, "")}`;
}
