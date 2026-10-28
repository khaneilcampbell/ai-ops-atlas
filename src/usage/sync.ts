import { useEffect, useRef } from "react";
import { intelApi } from "../intel/api";
import { useIntel } from "../intel/state";
import { isHostedWeb, isTauri } from "../lib/env";
import { parseImport, recordsFromRuns, type UsageRecord } from "./model";

// Website sync. The Mac app sends its recorded usage to the hosted site; the site shows the
// latest snapshot. The sync key lives in the Keychain and is only ever handled by Rust.

export interface SyncStatus {
  url: string | null;
  key_present: boolean;
  last_push_at: string | null;
  last_error: string | null;
}

async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}

/** Records in the import format (docs/api-usage.md), so the site validates them like a file. */
export function toSyncRows(records: UsageRecord[]) {
  return records.map((r) => ({
    at: r.at,
    provider: r.provider,
    model: r.model,
    agent: r.agent,
    project: r.project,
    requests: r.requests,
    input_tokens: r.input,
    output_tokens: r.output,
    cache_read_tokens: r.cacheRead,
    cache_write_tokens: r.cacheWrite,
    cost_usd: r.costUsd,
    cost_type: r.costKind,
  }));
}

export const usageSync = {
  available: isTauri,
  status: () => call<SyncStatus>("usage_sync_status"),
  setUrl: (url: string) => call<SyncStatus>("usage_sync_set_url", { url }),
  /** Returns the new key once, to paste into the site's USAGE_SYNC_TOKEN secret. */
  newKey: () => call<string>("usage_sync_new_key"),
  clear: () => call<SyncStatus>("usage_sync_clear"),
  /** Sends every run Atlas recorded. A no-op until a site URL and key are both set. */
  push: async (agent: string) => {
    const rows = toSyncRows(recordsFromRuns(await intelApi.runs(), agent));
    return call<SyncStatus>("usage_sync_push", { records: rows });
  },
};

export const syncConfigured = (s: SyncStatus | null) => !!s?.url && s.key_present;

/** Pushes after each finished run, while the app is open and sync is set up. No timer. */
export function useAutoPush() {
  const intel = useIntel();
  const latest = intel.status?.runs.find((r) => r.finished_at && r.usage)?.id ?? null;
  const agent = intel.status?.name ?? "Repository Intelligence";
  const seen = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (!usageSync.available() || !intel.status) return;
    // The first value is what was already there at launch; only later runs trigger a push.
    if (seen.current === undefined || seen.current === latest) {
      seen.current = latest;
      return;
    }
    seen.current = latest;
    void usageSync
      .status()
      .then((s) => (syncConfigured(s) ? usageSync.push(agent) : null))
      .catch(() => {
        /* the error is kept in the sync status and shown on the API Usage tab */
      });
  }, [latest, agent, intel.status]);
}

export interface WebSnapshot {
  configured: boolean;
  pushedAt: string | null;
  records: UsageRecord[];
}

/** The hosted site's copy of the Mac's records, read on open and on Refresh. */
export async function fetchWebSnapshot(): Promise<WebSnapshot | null> {
  if (!isHostedWeb()) return null;
  const r = await fetch("/api/usage", { credentials: "same-origin" });
  if (!r.ok) throw new Error(`The site couldn't read synced usage (${r.status}).`);
  const body = (await r.json()) as { configured: boolean; snapshot: { pushed_at: string; records: unknown[] } | null };
  if (!body.snapshot) return { configured: body.configured, pushedAt: null, records: [] };
  const { records } = parseImport(JSON.stringify(body.snapshot.records), "sync");
  return { configured: true, pushedAt: body.snapshot.pushed_at, records: records.map((x, i) => ({ ...x, id: `sync:${i}`, source: "sync" as const })) };
}
