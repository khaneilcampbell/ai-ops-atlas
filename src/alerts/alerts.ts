import type { Agent } from "../catalog/types";
import type { RegistryEntry } from "../registry/registry";
import { mainline } from "../registry/telemetry";
import type { ExecutionRecord } from "../registry/types";

// Alerts for unattended agents. An agent is watched when its manifest has an `alerts` block;
// what it reports through its live source decides the state. Nothing here guesses: with no
// source, no feed on this device, or no report yet, the state says unknown, not healthy.

export type WatchState =
  /** The latest completed run failed. Alert. */
  | "failing"
  /** No report within the manifest's window. Alert. */
  | "silent"
  /** The latest completed run succeeded and, when there is a window, it reported in time. */
  | "ok"
  /** Off on purpose (`alerts.not_running`). Never an alert. */
  | "not-running"
  /** Unknown: this device isn't receiving the agent's live source, or it has none. */
  | "no-source"
  /** Unknown: the source is connected but nothing has been reported yet. */
  | "no-reports";

export interface Watch {
  agent: Agent;
  state: WatchState;
  /** One line on what Atlas knows, for the list. */
  detail: string;
  /** The newest report of any kind, null when there is none. */
  last: ExecutionRecord | null;
  /** Identifies this occurrence of the alert, so dismissing it lasts until the next failure or
   *  silence. Null when the state isn't an alert. */
  key: string | null;
  /** When the alert started: the failed run, or the moment the window ran out. */
  since: string | null;
}

export const ALERTING: ReadonlySet<WatchState> = new Set(["failing", "silent"]);

export const STATE_LABEL: Record<WatchState, string> = {
  failing: "Failed",
  silent: "Silent",
  ok: "Healthy",
  "not-running": "Not running",
  "no-source": "Unknown",
  "no-reports": "No reports yet",
};

/** "3 h", "2 d": a window or a gap, in the largest whole unit. */
export function span(ms: number): string {
  const m = Math.round(ms / 60_000);
  if (m < 120) return `${m} min`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h} h` : `${Math.round(h / 24)} d`;
}

/**
 * The state of one watched agent at `now`. `feedLive` says whether this device is reading the
 * live feed right now: reports kept from earlier still show a failure, but silence can only be
 * judged while the feed is flowing.
 */
export function watchOf(agent: Agent, entry: RegistryEntry, now: number, feedLive: boolean): Watch {
  const rules = agent.alerts!;
  const t = entry.telemetry;
  const runs = mainline(t.executions);
  const last = runs[0] ?? null;
  const base = { agent, last, key: null, since: null };
  if (rules.notRunning) return { ...base, state: "not-running", detail: rules.notRunning };
  if (!t.source) return { ...base, state: "no-source", detail: "No live source is declared for this agent, so Atlas can't tell whether it works." };
  const done = runs.find((e) => e.result === "success" || e.result === "failure");
  if (rules.failures && done?.result === "failure") {
    return { ...base, state: "failing", detail: done.label, key: `${agent.id}:failed:${done.at}`, since: done.at };
  }
  if (!t.loaded || (t.source === "agent-feed" && !feedLive)) {
    const detail = t.source === "agent-feed" ? "This device isn't receiving the live feed right now, so the agent's reports can't be checked." : "Its live source hasn't loaded yet.";
    return { ...base, state: "no-source", detail };
  }
  if (!last) {
    const window = rules.reportWithinMs ? ` It should report at least every ${span(rules.reportWithinMs)}.` : "";
    return { ...base, state: "no-reports", detail: `Nothing reported on this device yet.${window}` };
  }
  const gap = now - Date.parse(last.at);
  if (rules.reportWithinMs && gap > rules.reportWithinMs) {
    const since = new Date(Date.parse(last.at) + rules.reportWithinMs).toISOString();
    return { ...base, state: "silent", detail: `No report for ${span(gap)}; it should report at least every ${span(rules.reportWithinMs)}.`, key: `${agent.id}:silent:${last.at}`, since };
  }
  return { ...base, state: "ok", detail: last.label };
}

const ORDER: Record<WatchState, number> = { failing: 0, silent: 1, "no-reports": 2, "no-source": 3, ok: 4, "not-running": 5 };

/** Every watched agent, alerts first. */
export function watchAgents(agents: Agent[], entries: RegistryEntry[], now: number, feedLive: boolean): Watch[] {
  const byId = new Map(entries.map((e) => [e.profile.id, e]));
  return agents
    .filter((a) => a.alerts && byId.has(a.id))
    .map((a) => watchOf(a, byId.get(a.id)!, now, feedLive))
    .sort((a, b) => ORDER[a.state] - ORDER[b.state] || a.agent.name.localeCompare(b.agent.name));
}

/** The alerts nobody has dismissed yet. */
export const openAlerts = (watches: Watch[], dismissed: ReadonlySet<string>) => watches.filter((w) => w.key && !dismissed.has(w.key));
