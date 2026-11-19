import { useCallback, useEffect, useState } from "react";
import { isHostedWeb, isTauri } from "../lib/env";
import type { DataOverview } from "./records";

// The Task Center's view of the Atlas database. The web page asks its own site (/api/data, behind
// Cloudflare Access); the database password lives only in the site's Hyperdrive binding and never
// reaches the page. The Mac app has no route to it yet, and says so instead of guessing.

export type OverviewState =
  | { state: "loading" }
  | { state: "off"; message: string }
  | { state: "not-configured"; message: string }
  | { state: "error"; message: string }
  | { state: "ready"; value: DataOverview };

const EVERY_MS = 2 * 60_000;

async function answerOf(r: Response): Promise<{ message?: string } & Record<string, unknown>> {
  return ((await r.json().catch(() => null)) as ({ message?: string } & Record<string, unknown>) | null) ?? {};
}

export async function fetchOverview(fetcher: typeof fetch = fetch): Promise<OverviewState> {
  if (!isHostedWeb()) return { state: "off", message: isTauri() ? "The database card shows on the Atlas web page for now. The Mac app doesn't read the database yet." : "The database is read by the hosted Atlas page." };
  const r = await fetcher("/api/data/overview", { credentials: "same-origin", cache: "no-store", signal: AbortSignal.timeout(15_000) });
  const body = await answerOf(r);
  if (r.status === 503) return { state: /isn't set up|Hyperdrive/.test(body.message ?? "") ? "not-configured" : "error", message: body.message ?? "The database isn't reachable." };
  if (!r.ok) return { state: "error", message: body.message ?? `The site answered ${r.status}.` };
  return { state: "ready", value: body as unknown as DataOverview };
}

/** Reads the overview on open, every two minutes while visible, and after each decision. */
export function useDataOverview(): { data: OverviewState; refresh: () => void } {
  const [data, setData] = useState<OverviewState>({ state: "loading" });
  const refresh = useCallback(() => {
    fetchOverview()
      .then(setData)
      .catch((e: unknown) => setData({ state: "error", message: e instanceof Error && e.name === "TimeoutError" ? "The site didn't answer within 15 seconds." : e instanceof Error ? e.message : String(e) }));
  }, []);
  useEffect(() => {
    refresh();
    if (!isHostedWeb()) return;
    const t = setInterval(() => document.visibilityState === "visible" && refresh(), EVERY_MS);
    return () => clearInterval(t);
  }, [refresh]);
  return { data, refresh };
}

/** Approve or reject one pending request. The key makes a double click count once. */
export async function decide(id: string, decision: "approve" | "reject", fetcher: typeof fetch = fetch): Promise<{ ok: boolean; message: string }> {
  const r = await fetcher(`/api/data/approvals/${encodeURIComponent(id)}/decision`, {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json", "idempotency-key": `decide-${id}-${decision}` },
    body: JSON.stringify({ decision }),
    signal: AbortSignal.timeout(15_000),
  });
  const body = await answerOf(r);
  if (!r.ok) return { ok: false, message: body.message ?? `The site answered ${r.status}.` };
  return { ok: true, message: decision === "approve" ? "Approved." : "Rejected." };
}
