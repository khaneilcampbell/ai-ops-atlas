import { useEffect, useMemo, useRef, useState } from "react";
import { useActions } from "../actions/state";
import { useAlerts } from "../alerts/state";
import { notify } from "../alerts/notify";
import { useExecutive } from "../executive/store";
import { appOrchestrator } from "../execution/app";
import { useLedgers } from "../execution/ledger";
import { useIntel as useAgentIntel } from "../intelligence/app";
import { useIntel } from "../intel/state";
import { isHostedWeb, isTauri } from "../lib/env";
import { useLiveStatus } from "../live/feed";
import { refreshN8n, useN8nRuns } from "../n8n/runs";
import { signalRows, type SignalRow } from "../observability/signals";
import { refreshSecurity, securityRepos, useSecurityAlerts } from "../security/alerts";
import { useAtlas } from "../state";
import { taskService, useTasks } from "../tasks/store";
import { useRuns } from "../workflows/runs";
import { deriveEvents } from "./derive";
import { runRound } from "./engine";
import type { Adapters, AdapterResult } from "./recovery";
import { opsStore, useOps } from "./store";
import type { EventSystem, Incident, OpsStop } from "./types";

// The app's operations layer: real inputs from the stores Atlas already has, real adapters that
// only read (or rebuild this device's cache), and the site's emergency stop. A round runs when
// those inputs change, plus a five-minute clock tick so timeouts are noticed. Nothing here polls
// an outside system on its own; the n8n and security reads keep their existing schedules.

const TICK_MS = 5 * 60_000;
/** GitHub fetches older than this count as stale for the signal row (twice the refresh interval). */
const STALE_FACTOR = 2;

export interface OpsInputs {
  signals: SignalRow[];
  derived: ReturnType<typeof deriveEvents>;
  observedAt: (s: EventSystem) => number | null;
  adapters: Adapters;
}

export function useOperationsRound(): OpsInputs {
  const { catalog, repos, settings, uncataloged, refresh } = useAtlas();
  const tasks = useTasks();
  const runs = useRuns();
  const ledgers = useLedgers();
  const executive = useExecutive();
  const { watches } = useAlerts();
  const live = useLiveStatus();
  const intel = useIntel();
  const { file: agentIntel } = useAgentIntel(catalog);
  const n8n = useN8nRuns();
  const secRepos = useMemo(() => securityRepos(catalog.projects.map((p) => p.repository)), [catalog]);
  const security = useSecurityAlerts(secRepos);
  const ops = useOps();
  const actions = useActions();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(t);
  }, []);

  const tracked = useMemo(() => [...new Set([...catalog.projects.map((p) => p.repository), ...catalog.agents.map((a) => a.repository), ...uncataloged])], [catalog, uncataloged]);
  const signals = useMemo(
    () =>
      // Usage sync isn't read here, so its row is left out rather than guessed.
      signalRows({ repos, tracked, staleAfterMs: settings.refreshMinutes * 60_000 * STALE_FACTOR, live, intel: { available: intel.available, error: intel.error, loaded: intel.status !== null, keyPresent: intel.status ? intel.status.key_present : null }, usage: { firstLoad: true, error: null, records: 0 }, n8n, security, now }).filter((r) => r.id !== "usage-sync"),
    [repos, tracked, settings.refreshMinutes, live, intel.available, intel.error, intel.status, n8n, security, now],
  );
  const n8nSnap = n8n.value?.state === "ok" ? n8n.value : null;
  const feedLive = live.state === "live";
  const derived = useMemo(
    () => deriveEvents({ now, catalog, tasks, runs, ledgers, watches, feedLive, signals, n8n: n8nSnap, repos, goals: executive.goals, evaluations: agentIntel.evaluations, audit: ops.audit }),
    [now, catalog, tasks, runs, ledgers, watches, feedLive, signals, n8nSnap, repos, executive.goals, agentIntel.evaluations, ops.audit],
  );
  const observedAt = useMemo(() => {
    const github = Math.max(0, ...Object.values(repos).map((r) => Date.parse((r && "data" in r ? r.data?.fetchedAt : undefined) ?? "") || 0));
    const integ = Math.max(0, ...signals.map((s) => (s.at ? Date.parse(s.at) : 0)));
    return (s: EventSystem): number | null => (s === "n8n" ? (n8nSnap ? Date.parse(n8nSnap.fetchedAt) : null) : s === "github" ? github || null : s === "integration" ? integ || null : s === "agent" ? (feedLive ? now : null) : s === "cloudflare" ? null : now);
  }, [repos, signals, n8nSnap, feedLive, now]);

  const ctx = { desktop: actions.available, agentsToken: !!actions.status?.agents_token };
  const adapters = useMemo<Adapters>(() => {
    const canRead = isHostedWeb() || isTauri();
    const asked = async (f: () => Promise<unknown>, what: string): Promise<AdapterResult> => {
      await f();
      return { state: "ok", detail: `Asked ${what} again. Verified on the next read.` };
    };
    const noReadPath = canRead ? null : "Runs in the hosted web page or the Mac app.";
    return {
      "status-refresh": { problem: () => noReadPath, run: () => asked(() => Promise.all([refreshN8n(), refreshSecurity(secRepos)]), "n8n and GitHub security") },
      "execution-reconcile": {
        problem: (i) => (i.runIds.length ? null : "This incident isn't tied to a workflow run, so there is nothing to reconcile."),
        run: async (i) => {
          const orch = appOrchestrator(catalog, ctx);
          const out = await Promise.all(i.runIds.map((r) => orch.reconcile(r)));
          const bad = out.find((o) => !o.ok);
          return bad && !bad.ok ? { state: "failed", detail: bad.error } : { state: "ok", detail: "Asked the outside system about runs past their timeout." };
        },
        reconcile: async () => ({ state: "unknown", detail: "Reconcile it in Workflow Intelligence: record whether it ran." }),
      },
      // Every executor Atlas has today changes something outside or is done by a person, so none
      // qualifies as read-only and idempotent. The playbook stays available for when one does.
      "task-retry": { problem: () => "No read-only, idempotent executor is connected: retry this task yourself in the Task Center.", run: async () => ({ state: "failed", detail: "Not available." }) },
      "cache-rebuild": { problem: () => null, run: () => asked(() => refresh(true), "GitHub for every tracked repository (cache rebuilt)") },
      "integration-recheck": {
        problem: (i: Incident) => (noReadPath ?? (i.evidence.some((e) => ["n8n", "github-security", "github", "live-feed"].includes(e.resource) || e.system === "n8n") ? null : "No recheck exists for this integration.")),
        run: async (i: Incident) => {
          const r = new Set(i.evidence.map((e) => (e.system === "n8n" ? "n8n" : e.resource)));
          const jobs: Promise<unknown>[] = [];
          if (r.has("n8n")) jobs.push(refreshN8n());
          if (r.has("github-security")) jobs.push(refreshSecurity(secRepos));
          if (r.has("github")) jobs.push(refresh(false));
          if (!jobs.length) return { state: "failed", detail: "No recheck exists for this integration." };
          return asked(() => Promise.all(jobs), [...r].join(", "));
        },
      },
    };
    // ctx is rebuilt each render; the orchestrator is cached on its key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalog, secRepos, refresh, actions.available, actions.status?.agents_token]);

  const level = executive.autonomy;
  // One round at a time; a change during a round queues exactly one more with the latest inputs.
  const busy = useRef(false);
  const pending = useRef<(() => Promise<unknown>) | null>(null);
  useEffect(() => {
    const go = () => runRound({ store: opsStore(), adapters, level, catalog, goals: executive.goals, tasks, createTask: (input, actor) => taskService().create(input, actor), notify: (t, b) => void notify(t, b), observedAt, now }, derived);
    if (busy.current) {
      pending.current = go;
      return;
    }
    busy.current = true;
    const loop = async (job: () => Promise<unknown>) => {
      try {
        await job();
      } finally {
        const next = pending.current;
        pending.current = null;
        if (next) void loop(next);
        else busy.current = false;
      }
    };
    void loop(go);
  }, [derived, adapters, level, catalog, executive.goals, tasks, observedAt, now]);

  return { signals, derived, observedAt, adapters };
}

/** The site-wide stop (web page only, behind Access). The Mac app's stop holds its own sends. */
export const siteStop = {
  available: () => isHostedWeb(),
  async read(): Promise<{ active: boolean; reason: string; by: string | null } | null> {
    if (!isHostedWeb()) return null;
    const r = await fetch("/api/ops/control", { credentials: "same-origin", cache: "no-store" });
    return r.ok ? r.json() : null;
  },
  async set(active: boolean, reason: string): Promise<OpsStop["site"]> {
    if (!isHostedWeb()) return "not_available";
    try {
      const r = await fetch("/api/ops/control", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ active, reason }) });
      return r.ok ? "confirmed" : "not_reached";
    } catch {
      return "not_reached";
    }
  },
};
