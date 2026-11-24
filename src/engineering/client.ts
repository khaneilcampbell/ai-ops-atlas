import { useCallback, useEffect, useState } from "react";
import { isHostedWeb, isTauri } from "../lib/env";
import { ACTIVITY_LABEL } from "./lifecycle";
import { TERMINAL_PHASES, type EngineeringOverview, type ExecutionView, type IncidentView } from "./types";

// The Engineering Operations panel's view of the division. Like the Executive panel, only the hosted
// web page reads it (/api/executive/engineering, behind Cloudflare Access); the Mac app points there.

export type EngineeringState =
  | { state: "loading" }
  | { state: "off"; message: string }
  | { state: "not-configured"; message: string }
  | { state: "error"; message: string }
  | { state: "ready"; value: EngineeringOverview };

export async function fetchEngineering(fetcher: typeof fetch = fetch, hosted = isHostedWeb(), app = isTauri()): Promise<EngineeringState> {
  if (app) return { state: "off", message: "Engineering Operations runs on the Atlas web page. Open it there to follow repairs." };
  if (!hosted) return { state: "off", message: "Engineering Operations runs on the hosted Atlas web page." };
  const r = await fetcher("/api/executive/engineering", { credentials: "same-origin", cache: "no-store", signal: AbortSignal.timeout(15_000) });
  const body = ((await r.json().catch(() => null)) as (EngineeringOverview & { message?: string }) | null) ?? ({} as EngineeringOverview & { message?: string });
  if (r.status === 503) return { state: "not-configured", message: body.message ?? "The engineering tables aren't set up yet (migration 0004)." };
  if (!r.ok) return { state: "error", message: body.message ?? `The site answered ${r.status}.` };
  return { state: "ready", value: body };
}

export function useEngineering(): { data: EngineeringState; refresh: () => void } {
  const [data, setData] = useState<EngineeringState>({ state: "loading" });
  const refresh = useCallback(() => {
    fetchEngineering()
      .then(setData)
      .catch((e: unknown) => setData({ state: "error", message: e instanceof Error ? e.message : String(e) }));
  }, []);
  useEffect(() => {
    refresh();
    if (!isHostedWeb()) return;
    const t = setInterval(() => document.visibilityState === "visible" && refresh(), 60_000);
    return () => clearInterval(t);
  }, [refresh]);
  return { data, refresh };
}

export interface EngineeringSummary {
  running: ExecutionView[];
  openIncidents: IncidentView[];
  failedCi: number;
  prsOpen: number;
  qaPassed: number;
  qaFailed: number;
  failures: number;
  /** Plain words for what's missing before the division can run for real (empty when ready). */
  setup: string[];
  line: string;
}

/** Pure counts for the panel. Same overview in, same numbers out. */
export function summariseEngineering(o: EngineeringOverview): EngineeringSummary {
  const running = o.executions.filter((e) => !TERMINAL_PHASES.has(e.phase));
  const openIncidents = o.incidents.filter((i) => ["detected", "assigned", "awaiting_approval", "repairing"].includes(i.status));
  const failedCi = o.incidents.length;
  const prsOpen = o.executions.filter((e) => e.prUrl).length;
  const qaPassed = o.executions.filter((e) => e.qaOutcome === "PASS").length;
  const qaFailed = o.executions.filter((e) => e.qaOutcome === "FAIL").length;
  const failures = o.executions.filter((e) => e.phase === "FAILED").length + o.incidents.filter((i) => i.status === "escalated" || i.status === "failed").length;
  const setup = [
    !o.configured.enabled ? "Automatic repair is off (ATLAS_ENGINEERING_ENABLED)" : null,
    !o.configured.n8n ? "The n8n bridge keys aren't set" : null,
    !o.configured.github ? "The site's GitHub token isn't set, so QA can't read results" : null,
    !o.configured.runnerCallback ? "The runner's callback key isn't set" : null,
  ].filter((x): x is string => !!x);
  const eng = o.agents.find((a) => a.id === "atlas-engineer");
  const parts = [eng ? `Engineering ${ACTIVITY_LABEL[eng.activity].toLowerCase()}` : null, `${openIncidents.length} open`, running.length ? `${running.length} running` : null, prsOpen ? `${prsOpen} pull request${prsOpen === 1 ? "" : "s"}` : null].filter(Boolean);
  return { running, openIncidents, failedCi, prsOpen, qaPassed, qaFailed, failures, setup, line: parts.join(" · ") };
}
