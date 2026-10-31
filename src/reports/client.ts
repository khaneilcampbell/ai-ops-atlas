import { useEffect, useState } from "react";
import { isHostedWeb, isTauri } from "../lib/env";
import { onLiveEvents } from "../live/feed";
import { validOpportunityReport, type ReportAgent, type StoredReport } from "./model";

// Reads an agent's stored reports from the site (server/reports.ts): the signed-in page through
// /api/reports, the Mac app through its sync key. Refreshes when the live feed says a new one landed.

export interface ReportsState {
  /** off: no site to ask (plain dev, or website sync not set up on the Mac). */
  state: "off" | "loading" | "ready" | "error";
  message: string | null;
  reports: StoredReport[];
}

interface Page {
  configured: boolean;
  reports: unknown[];
}

async function fetchReports(agent: ReportAgent): Promise<Page | null> {
  if (isHostedWeb()) {
    const r = await fetch(`/api/reports?agent=${encodeURIComponent(agent)}`, { credentials: "same-origin", cache: "no-store" });
    if (!r.ok) throw new Error(((await r.json().catch(() => null)) as { message?: string } | null)?.message ?? `The site answered ${r.status}.`);
    return (await r.json()) as Page;
  }
  if (isTauri()) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<Page | null>("live_reports", { agent });
  }
  return null;
}

/** Only well-formed reports survive; the site checks too, this guards against an older site. */
export function cleanReports(page: Page): StoredReport[] {
  return (Array.isArray(page.reports) ? page.reports : []).filter(
    (r): r is StoredReport => !!r && typeof r === "object" && typeof (r as StoredReport).id === "number" && validOpportunityReport((r as StoredReport).body),
  );
}

export function useAgentReports(agent: ReportAgent): ReportsState {
  const [s, setS] = useState<ReportsState>({ state: "loading", message: null, reports: [] });
  const [tick, setTick] = useState(0);

  useEffect(
    () =>
      onLiveEvents((events) => {
        if (events.some((e) => e.kind === "agent_report" && e.body?.agent === agent)) setTick((n) => n + 1);
      }),
    [agent],
  );

  useEffect(() => {
    let alive = true;
    fetchReports(agent)
      .then((page) => {
        if (!alive) return;
        if (!page) setS({ state: "off", message: "Reports need website sync (Settings → Website sync).", reports: [] });
        else if (!page.configured) setS({ state: "off", message: "Reports aren't set up on the site yet.", reports: [] });
        else setS({ state: "ready", message: null, reports: cleanReports(page) });
      })
      .catch((e) => alive && setS((prev) => ({ state: "error", message: e instanceof Error ? e.message : String(e), reports: prev.reports })));
    return () => {
      alive = false;
    };
  }, [agent, tick]);

  return s;
}
