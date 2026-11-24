import { isTauri } from "../lib/env";
import { sanitizeSnapshot, type InvestmentSnapshot } from "./investments";
import { sanitizeJournal, type Journal } from "./tradingDesk";

// The Mac app's side of the Investment Operations Center: reads the one snapshot file Claude Code
// writes on "sync my investments" (src-tauri/src/investments.rs) and deletes it on Disconnect.
// The website has no snapshot: account data never leaves the Mac.

export type LocalSnapshot =
  | { kind: "web" }
  | { kind: "none"; path: string }
  | { kind: "ok"; path: string; snapshot: InvestmentSnapshot }
  | { kind: "refused"; path: string; errors: string[] }
  | { kind: "error"; message: string };

interface SnapshotFile { path: string; contents: string | null; modified_ms: number | null }

/** Turns the file's text into what the panel shows. Anything off the allowlist is refused whole. */
export function parseLocalSnapshot(file: SnapshotFile, now: Date = new Date()): LocalSnapshot {
  if (file.contents == null) return { kind: "none", path: file.path };
  let json: unknown;
  try { json = JSON.parse(file.contents); } catch { return { kind: "refused", path: file.path, errors: ["snapshot: not valid JSON"] }; }
  const r = sanitizeSnapshot(json, now);
  return r.ok ? { kind: "ok", path: file.path, snapshot: r.snapshot } : { kind: "refused", path: file.path, errors: r.errors };
}

export async function readLocalSnapshot(): Promise<LocalSnapshot> {
  if (!isTauri()) return { kind: "web" };
  const { invoke } = await import("@tauri-apps/api/core");
  try {
    return parseLocalSnapshot(await invoke<SnapshotFile>("investments_snapshot"));
  } catch (e) {
    return { kind: "error", message: String(e) };
  }
}

export async function disconnectLocalSnapshot(): Promise<void> {
  if (!isTauri()) return;
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("investments_disconnect");
}

export type LocalJournal =
  | { kind: "web" }
  | { kind: "none" }
  | { kind: "ok"; journal: Journal }
  | { kind: "refused"; errors: string[] }
  | { kind: "error"; message: string };

/** The trade journal the Trade Desk writes beside the snapshot. Refused whole if anything is off the allowlist. */
export function parseLocalJournal(file: SnapshotFile, now: Date = new Date()): LocalJournal {
  if (file.contents == null) return { kind: "none" };
  let json: unknown;
  try { json = JSON.parse(file.contents); } catch { return { kind: "refused", errors: ["journal: not valid JSON"] }; }
  const r = sanitizeJournal(json, now);
  return r.ok ? { kind: "ok", journal: r.journal } : { kind: "refused", errors: r.errors };
}

export async function readLocalJournal(): Promise<LocalJournal> {
  if (!isTauri()) return { kind: "web" };
  const { invoke } = await import("@tauri-apps/api/core");
  try {
    return parseLocalJournal(await invoke<SnapshotFile>("investments_journal"));
  } catch (e) {
    return { kind: "error", message: String(e) };
  }
}
