import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { intelApi } from "./api";
import { publishLocal, useLiveStatus } from "../live/feed";
import type { IntelSource } from "../registry/registry";
import type { AgentConfig, AgentStatus, Depth, RepoContext, Report, Run } from "./types";

interface IntelState {
  available: boolean;
  status: AgentStatus | null;
  /** Runs for telemetry: the full status on the Mac, or the runs the Mac reported, live, on the website. */
  telemetry: IntelSource | null;
  reports: Record<string, Report>;
  error: string | null;
  reload: () => Promise<void>;
  analyze: (repo: string, opts?: { force?: boolean; depth?: Depth | null; context?: RepoContext }) => Promise<{ run_id: string; duplicate: boolean }>;
  cancel: (runId: string) => Promise<boolean>;
  setConfig: (c: AgentConfig) => Promise<AgentConfig>;
}

const Ctx = createContext<IntelState | null>(null);

/** Agent status and saved reports, kept fresh from the Rust side's change events. */
export function IntelProvider({ children }: { children: ReactNode }) {
  const available = intelApi.available();
  const [status, setStatus] = useState<AgentStatus | null>(null);
  const [reports, setReports] = useState<Record<string, Report>>({});
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!available) return;
    try {
      const [s, rs] = await Promise.all([intelApi.status(), intelApi.reports()]);
      setStatus(s);
      setReports(Object.fromEntries(rs.map((r) => [r.repo.toLowerCase(), r])));
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }, [available]);

  useEffect(() => {
    if (!available) return;
    void reload();
    let unlisten: (() => void) | undefined;
    let pending: ReturnType<typeof setTimeout> | undefined;
    // Events arrive in bursts while a run moves through its steps; coalesce them.
    void intelApi
      .onChange(() => {
        clearTimeout(pending);
        pending = setTimeout(() => void reload(), 150);
      })
      .then((u) => (unlisten = u));
    return () => {
      clearTimeout(pending);
      unlisten?.();
    };
  }, [available, reload]);

  // The Mac tells the site about each run as it changes, so the website shows it live.
  const sent = useRef(new Map<string, string>());
  useEffect(() => {
    if (!available || !status) return;
    const changed = status.runs.filter((r) => sent.current.get(r.id) !== r.status);
    const first = sent.current.size === 0;
    for (const r of status.runs) sent.current.set(r.id, r.status);
    // On launch only what's unfinished or recent matters; older runs are history, not live.
    const recent = Date.now() - 6 * 3_600_000;
    const out = changed.filter((r) => !first || r.status === "queued" || r.status === "running" || Date.parse(r.finished_at ?? r.queued_at) >= recent).slice(0, 50);
    void publishLocal(out.map((r) => ({ kind: "intel_run" as const, repo: r.repo, body: liveRun(r) }))).catch(() => {
      for (const r of out) sent.current.delete(r.id); // retried on the next change
    });
  }, [available, status]);

  const live = useLiveStatus();
  const telemetry = useMemo<IntelSource | null>(() => status ?? (live.intelRuns ? { runs: live.intelRuns } : null), [status, live.intelRuns]);

  const value = useMemo<IntelState>(
    () => ({
      available,
      status,
      telemetry,
      reports,
      error,
      reload,
      analyze: async (repo, opts) => {
        const r = await intelApi.analyze(repo, opts);
        void reload();
        return r;
      },
      cancel: async (id) => {
        const ok = await intelApi.cancel(id);
        void reload();
        return ok;
      },
      setConfig: async (c) => {
        const next = await intelApi.setConfig(c);
        void reload();
        return next;
      },
    }),
    [available, status, telemetry, reports, error, reload],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useIntel(): IntelState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useIntel outside IntelProvider");
  return v;
}

/** What the website needs to show a run: status, timing and cost. No trace, prompts or report text. */
function liveRun(r: Run): Partial<Run> {
  const { id, repo, trigger, depth, model, force, status, queued_at, started_at, finished_at, duration_ms, attempts, github_requests, cost_usd } = r;
  return { id, repo, trigger, depth, model, force, status, queued_at, started_at, finished_at, duration_ms, attempts, github_requests, cost_usd, error: r.error ? { ...r.error, message: "" } : null, usage: null, estimate: null, trace: [] };
}
