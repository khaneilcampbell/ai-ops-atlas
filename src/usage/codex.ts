import { isTauri } from "../lib/env";
import { parseImport, type UsageRecord } from "./model";

// ChatGPT Codex usage from the session logs Codex keeps on this Mac (src-tauri/src/codex_usage.rs).
// Numbers only: tokens, model, folder name. Plan usage has no price, so these rows carry no cost.
// Read on open and on Refresh. The website sees them through website sync, like the Mac's own runs.

/** `null` when this isn't the Mac app or Codex has no logs on it. */
export async function readCodexUsage(): Promise<UsageRecord[] | null> {
  if (!isTauri()) return null;
  const { invoke } = await import("@tauri-apps/api/core");
  const rows = await invoke<unknown[] | null>("codex_usage");
  return rows ? codexRecords(rows) : null;
}

export function codexRecords(rows: unknown[]): UsageRecord[] {
  const { records } = parseImport(JSON.stringify(rows), "codex");
  return records.map((r, i) => ({ ...r, id: `codex:${i}`, source: "codex" as const }));
}
