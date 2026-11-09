import { isTauri } from "../lib/env";
import { parseImport, type UsageRecord } from "./model";

// Your own AI tool use, from the session logs those tools already keep on this Mac
// (src-tauri/src/local_usage.rs): ChatGPT Codex (~/.codex/sessions) and Claude Code
// (~/.claude/projects). Numbers only: tokens, model, start time, folder name. Both run on a
// subscription plan, so the rows carry no cost. Read on open and on Refresh; the website sees
// them through website sync, like the Mac's own runs.

/** `null` when this isn't the Mac app or neither tool has logs on it. */
export async function readLocalUsage(): Promise<UsageRecord[] | null> {
  if (!isTauri()) return null;
  const { invoke } = await import("@tauri-apps/api/core");
  // One tool's logs failing to read never hides the other's.
  const [codex, claude] = await Promise.all([
    invoke<unknown[] | null>("codex_usage").catch(() => null),
    invoke<unknown[] | null>("claude_code_usage").catch(() => null),
  ]);
  if (!codex && !claude) return null;
  return [...localRecords(codex ?? [], "codex"), ...localRecords(claude ?? [], "claude-code")];
}

export function localRecords(rows: unknown[], tool: string): UsageRecord[] {
  const { records } = parseImport(JSON.stringify(rows), tool);
  return records.map((r, i) => ({ ...r, id: `${tool}:${i}`, source: "local" as const }));
}
