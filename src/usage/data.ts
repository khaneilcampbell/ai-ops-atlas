import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { intelApi } from "../intel/api";
import type { Run } from "../intel/types";
import { useIntel } from "../intel/state";
import { isHostedWeb } from "../lib/env";
import { load, remove, save } from "../lib/storage";
import { fetchAgentUsage, type AgentUsage } from "./agents";
import { readLocalUsage } from "./local";
import { recordsFromRuns, type UsageRecord } from "./model";
import { fetchWebSnapshot, syncConfigured, usageSync, type SyncStatus, type WebSnapshot } from "./sync";

// Every usage record Atlas can see: this Mac's agent runs, the Mac's records on the website, what
// GitHub-run agents reported, Codex and Claude Code logs on this Mac, and imported files.

export interface ImportStore {
  files: { name: string; importedAt: string; count: number }[];
  records: UsageRecord[];
}
const IMPORT_KEY = "usageImports";

/**
 * Reads usage Atlas already logged, on open and when Refresh is pressed. No polling, no model calls.
 * `push` also sends this Mac's records to the website when website sync is set up (the Usage view
 * does; a building panel that only reads the numbers doesn't).
 */
export function useUsageData({ push = true }: { push?: boolean } = {}) {
  const intel = useIntel();
  const hosted = isHostedWeb();
  const [runs, setRuns] = useState<Run[] | null>(null);
  const [snapshot, setSnapshot] = useState<WebSnapshot | null>(null);
  const [agentUsage, setAgentUsage] = useState<AgentUsage | null>(null);
  const [agentError, setAgentError] = useState<string | null>(null);
  const [local, setLocal] = useState<UsageRecord[] | null>(null);
  const [sync, setSync] = useState<SyncStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(intel.available || hosted);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [imports, setImports] = useState<ImportStore>(() => load<ImportStore>(IMPORT_KEY, { files: [], records: [] }));
  const agentName = intel.status?.name ?? "Repository Intelligence";
  const agentRef = useRef(agentName);
  agentRef.current = agentName;

  const refresh = useCallback(async () => {
    setImports(load<ImportStore>(IMPORT_KEY, { files: [], records: [] }));
    if (!intel.available && !hosted) {
      setUpdatedAt(new Date().toISOString());
      return;
    }
    setLoading(true);
    // Usage the GitHub-run agents reported to the site. Its own error, so it never hides local records.
    const agents = fetchAgentUsage()
      .then((a) => {
        setAgentUsage(a);
        setAgentError(null);
      })
      .catch((e) => setAgentError(e instanceof Error ? e.message : String(e)));
    try {
      if (intel.available) {
        setRuns(await intelApi.runs());
        // ChatGPT Codex and Claude Code sessions on this Mac; a read problem there never hides the rest.
        setLocal(await readLocalUsage().catch(() => null));
        // Refresh also sends the records to the website, when website sync is set up.
        const st = await usageSync.status();
        setSync(push && syncConfigured(st) ? await usageSync.push(agentRef.current).catch(() => usageSync.status()) : st);
      } else {
        setSnapshot(await fetchWebSnapshot());
      }
      await agents;
      setError(null);
      setUpdatedAt(new Date().toISOString());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [intel.available, hosted, push]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const addImport = (name: string, records: UsageRecord[]) => {
    const next: ImportStore = {
      files: [...imports.files.filter((f) => f.name !== name), { name, importedAt: new Date().toISOString(), count: records.length }],
      records: [...imports.records.filter((r) => !r.id.startsWith(`import:${name}:`)), ...records],
    };
    save(IMPORT_KEY, next);
    setImports(load<ImportStore>(IMPORT_KEY, { files: [], records: [] }));
  };
  const clearImports = () => {
    remove(IMPORT_KEY);
    setImports({ files: [], records: [] });
  };

  const records = useMemo(
    () => [...recordsFromRuns(runs ?? [], agentName), ...(snapshot?.records ?? []), ...(agentUsage?.records ?? []), ...(local ?? []), ...imports.records],
    [runs, agentName, snapshot, agentUsage, local, imports.records],
  );
  const oldestRun = runs?.find((r) => r.usage)?.started_at ?? null;
  const firstLoad = loading && runs === null && snapshot === null;

  return { available: intel.available, keyPresent: intel.status?.key_present ?? false, records, runs, snapshot, agentUsage, agentError, sync, imports, loading, firstLoad, error, updatedAt, oldestRun, refresh, addImport, clearImports };
}

