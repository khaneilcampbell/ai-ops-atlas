import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { actionsApi } from "./api";
import type { ActionsStatus, AuditRecord, Outcome } from "./types";

interface ActionsState {
  available: boolean;
  status: ActionsStatus | null;
  /** Newest first. */
  audit: AuditRecord[];
  reload: () => Promise<void>;
  rerunFailed: (repo: string, runId: number, seenAttempt: number | null) => Promise<Outcome>;
}

const Ctx = createContext<ActionsState | null>(null);

/** The action switch, token presence and audit log, kept fresh from the Rust side's change events. */
export function ActionsProvider({ children }: { children: ReactNode }) {
  const available = actionsApi.available();
  const [status, setStatus] = useState<ActionsStatus | null>(null);
  const [audit, setAudit] = useState<AuditRecord[]>([]);

  const reload = useCallback(async () => {
    if (!available) return;
    try {
      const [s, log] = await Promise.all([actionsApi.status(), actionsApi.audit(500)]);
      setStatus(s);
      setAudit(log);
    } catch {
      // Older builds without the actions commands: behave as if everything is off.
      setStatus(null);
    }
  }, [available]);

  useEffect(() => {
    if (!available) return;
    void reload();
    let unlisten: (() => void) | undefined;
    void actionsApi.onChange(() => void reload()).then((u) => (unlisten = u));
    return () => unlisten?.();
  }, [available, reload]);

  const value = useMemo<ActionsState>(
    () => ({ available, status, audit, reload, rerunFailed: actionsApi.rerunFailed }),
    [available, status, audit, reload],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useActions(): ActionsState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useActions outside ActionsProvider");
  return v;
}
