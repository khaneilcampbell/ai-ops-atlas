import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { intelApi } from "./api";
import type { AgentConfig, AgentStatus, Depth, EcoContext, EcoReport, RepoContext, Report } from "./types";

interface IntelState {
  available: boolean;
  status: AgentStatus | null;
  reports: Record<string, Report>;
  /** The latest Senior Engineering Review, if one has run. */
  review: EcoReport | null;
  error: string | null;
  reload: () => Promise<void>;
  analyze: (repo: string, opts?: { force?: boolean; depth?: Depth | null; context?: RepoContext }) => Promise<{ run_id: string; duplicate: boolean }>;
  runReview: (context: EcoContext, opts?: { force?: boolean; depth?: Depth | null }) => Promise<{ run_id: string; duplicate: boolean }>;
  cancel: (runId: string) => Promise<boolean>;
  setConfig: (c: AgentConfig) => Promise<AgentConfig>;
}

const Ctx = createContext<IntelState | null>(null);

/** Agent status and saved reports, kept fresh from the Rust side's change events. */
export function IntelProvider({ children }: { children: ReactNode }) {
  const available = intelApi.available();
  const [status, setStatus] = useState<AgentStatus | null>(null);
  const [reports, setReports] = useState<Record<string, Report>>({});
  const [review, setReview] = useState<EcoReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!available) return;
    try {
      const [s, rs, rv] = await Promise.all([intelApi.status(), intelApi.reports(), intelApi.review()]);
      setStatus(s);
      setReview(rv);
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

  const value = useMemo<IntelState>(
    () => ({
      available,
      status,
      reports,
      review,
      error,
      reload,
      analyze: async (repo, opts) => {
        const r = await intelApi.analyze(repo, opts);
        void reload();
        return r;
      },
      runReview: async (context, opts) => {
        const r = await intelApi.runReview(context, opts);
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
    [available, status, reports, review, error, reload],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useIntel(): IntelState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useIntel outside IntelProvider");
  return v;
}
