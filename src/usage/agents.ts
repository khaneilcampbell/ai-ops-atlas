import { isHostedWeb, isTauri } from "../lib/env";
import { parseImport, type UsageRecord } from "./model";

// Model usage the GitHub-run agents reported to the site (server/agentUsage.ts): the signed-in
// page reads /api/usage/agents, the Mac app reads it through its sync key. Read on open and on
// Refresh only. Rows are re-validated here exactly like an imported file.

export interface AgentUsage {
  /** false: the site has no database yet. */
  configured: boolean;
  records: UsageRecord[];
}

interface Page {
  configured: boolean;
  records: unknown[];
}

export function agentRecords(page: Page): UsageRecord[] {
  const rows = Array.isArray(page.records) ? page.records : [];
  const { records } = parseImport(JSON.stringify(rows), "agent");
  return records.map((r, i) => ({ ...r, id: `agent:${i}`, source: "agent" as const }));
}

/** `null` when there's no site to ask (plain dev, or website sync not set up on the Mac). */
export async function fetchAgentUsage(): Promise<AgentUsage | null> {
  let page: Page | null = null;
  if (isHostedWeb()) {
    const r = await fetch("/api/usage/agents", { credentials: "same-origin", cache: "no-store" });
    if (!r.ok) throw new Error(`The site couldn't read agent usage (${r.status}).`);
    page = (await r.json()) as Page;
  } else if (isTauri()) {
    const { invoke } = await import("@tauri-apps/api/core");
    page = await invoke<Page | null>("live_agent_usage");
  }
  if (!page) return null;
  return { configured: !!page.configured, records: agentRecords(page) };
}
