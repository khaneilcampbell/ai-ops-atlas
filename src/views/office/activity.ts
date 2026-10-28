import { useEffect, useMemo, useRef, useState } from "react";
import { useActions } from "../../actions/state";
import type { Agent } from "../../catalog/types";
import type { RepoState } from "../../github/types";
import { useIntel } from "../../intel/state";
import { buildRegistry } from "../../registry/registry";
import { useAtlas } from "../../state";
import { runtimeFor, type Runtime } from "./model";

/**
 * How a building on the map is lit by the work going on inside it. Driven by the same verified
 * runtime states as the office desks, so a building only lights up when a run is observed.
 */
export type Illumination = "idle" | "running" | "completed" | "error";

/** How long the green confirmation stays before the building fades back to normal. */
export const COMPLETE_MS = 2600;

const RANK: Record<Illumination, number> = { idle: 0, completed: 1, error: 2, running: 3 };

/** Map keys: an agent's house is `agent:<id>`, a project's headquarters is `repo:<repository>`. */
export function buildingStates(agents: Pick<Agent, "id" | "repository">[], runtimes: Map<string, Runtime>, completed: ReadonlySet<string> = new Set()): Map<string, Illumination> {
  const out = new Map<string, Illumination>();
  for (const a of agents) {
    const r = runtimes.get(a.id);
    const s: Illumination = r?.state === "working" ? "running" : r?.state === "failed" ? "error" : completed.has(a.id) ? "completed" : "idle";
    if (s === "idle") continue;
    out.set(`agent:${a.id}`, s);
    // A headquarters shows the most pressing state among its agents.
    const hq = `repo:${a.repository}`;
    if (RANK[s] > RANK[out.get(hq) ?? "idle"]) out.set(hq, s);
  }
  return out;
}

/** Agents seen running before and now idle with a successful latest run: they just finished. */
export function justCompleted(prev: Map<string, Runtime>, next: Map<string, Runtime>): string[] {
  const out: string[] = [];
  for (const [id, r] of next) {
    if (prev.get(id)?.state === "working" && r.state === "idle" && r.basis?.result === "success") out.push(id);
  }
  return out;
}

/** A GitHub snapshot synced within the refresh interval. */
export function isFresh(state: RepoState | undefined): boolean {
  return state?.kind === "ok" && !state.stale;
}

/** Live illumination for every building, from the catalog, GitHub snapshots and the app's own logs. */
export function useBuildingActivity(): Map<string, Illumination> {
  const { catalog, repos } = useAtlas();
  const { status: intel } = useIntel();
  const actions = useActions();
  const runtimes = useMemo(() => {
    const data = { available: actions.available, status: actions.status, audit: actions.audit };
    const byId = new Map(catalog.agents.map((a) => [a.id, a]));
    return new Map(buildRegistry(catalog, repos, intel).map((e) => [e.profile.id, runtimeFor(byId.get(e.profile.id)!, e.telemetry, data)]));
  }, [catalog, repos, intel, actions.available, actions.status, actions.audit]);

  // A completion is a transition Atlas observed in this session, never inferred from history.
  const prev = useRef(runtimes);
  const [completed, setCompleted] = useState<ReadonlySet<string>>(new Set());
  useEffect(() => {
    const done = justCompleted(prev.current, runtimes);
    prev.current = runtimes;
    if (!done.length) return;
    setCompleted((c) => new Set([...c, ...done]));
    const t = setTimeout(() => setCompleted((c) => new Set([...c].filter((id) => !done.includes(id)))), COMPLETE_MS);
    return () => clearTimeout(t);
  }, [runtimes]);

  // A building is lit only from current data: an agent read from a GitHub snapshot that is out of
  // date (a failed or skipped sync) stays unlit rather than showing what was true hours ago.
  const live = useMemo(() => catalog.agents.filter((a) => !a.observe?.githubWorkflow || isFresh(repos[a.repository])), [catalog.agents, repos]);
  return useMemo(() => buildingStates(live, runtimes, completed), [live, runtimes, completed]);
}
