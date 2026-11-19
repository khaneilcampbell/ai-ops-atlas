import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { load, save } from "../lib/storage";
import { useN8nRuns } from "../n8n/runs";
import type { N8nSnapshot } from "../n8n/types";
import { identityFor } from "../registry/identity";
import { useAtlas } from "../state";
import { useTasks } from "../tasks/store";
import { loadLedger, observe, saveLedger, type Ledger } from "./ledger";
import { agentOps, sightingsOf, type AgentOps } from "./operations";
import type { Routine } from "./routine";

/**
 * Every named agent's operational state, from the shared n8n poll (one request for all agents,
 * only while the window is visible), GitHub runs Atlas already reads, and the Task Center. The last
 * n8n summary is kept so a reload shows the last known schedule at once, marked with its age.
 */
const SNAP_KEY = "routine-n8n-snapshot";
/** How often the state is re-evaluated without new data (a schedule coming due). */
const TICK_MS = 20_000;

let ledger: Ledger | null = null;
const ledgerOf = () => (ledger ??= loadLedger());

export interface RoutineOps {
  ops: Map<string, AgentOps>;
  /** The n8n summary in use and whether it's live or the saved copy. */
  source: "live" | "saved" | "none";
  fetchedAt: string | null;
  /** Why live n8n data isn't available, when it isn't. */
  message: string | null;
  now: number;
}

function useTick(ms: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => document.visibilityState === "visible" && setNow(Date.now()), ms);
    const wake = () => document.visibilityState === "visible" && setNow(Date.now());
    document.addEventListener("visibilitychange", wake);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", wake);
    };
  }, [ms]);
  return now;
}

export function useRoutineOps(personaIds: readonly string[]): RoutineOps {
  const { catalog, repos } = useAtlas();
  const n8n = useN8nRuns();
  const tasks = useTasks();
  const now = useTick(TICK_MS);
  const live = n8n.state === "ready" && n8n.value?.state === "ok" ? n8n.value : null;
  useEffect(() => {
    if (live) save(SNAP_KEY, live);
  }, [live]);
  const snap: N8nSnapshot | null = useMemo(() => live ?? load<N8nSnapshot | null>(SNAP_KEY, null), [live]);
  const ops = useMemo(() => {
    const l = ledgerOf();
    const personaOf = (id: string) => identityFor(id, catalog.agents).personaId;
    const build = () => new Map(personaIds.map((id) => [id, agentOps(id, { agents: catalog.agents, n8n: snap, repos, tasks, seen: l, personaOf, now })]));
    let out = build();
    // Record first sightings, then rebuild once so new runs carry their times.
    let changed = false;
    for (const o of out.values()) changed = observe(l, sightingsOf(o.runs), now) || changed;
    if (changed) {
      saveLedger(l);
      out = build();
    }
    return out;
  }, [catalog.agents, snap, repos, tasks, now, personaIds]);
  return {
    ops,
    source: live ? "live" : snap ? "saved" : "none",
    fetchedAt: snap?.state === "ok" ? snap.fetchedAt : null,
    message: live ? null : n8n.message,
    now,
  };
}

// ------------------------------------------------------------------------------------- pause in Atlas

/**
 * Agents whose city routine Khaneil paused in Atlas: the character stays home. This never pauses
 * real work: scheduled runs keep their n8n or GitHub triggers (the settings view links there).
 */
const HELD_KEY = "routine-held";
let held = new Set<string>(load<string[]>(HELD_KEY, []));
const heldWatchers = new Set<() => void>();
export function setRoutineHeld(personaId: string, on: boolean) {
  const next = new Set(held);
  if (on) next.add(personaId);
  else next.delete(personaId);
  held = next;
  save(HELD_KEY, [...next]);
  heldWatchers.forEach((w) => w());
}
export function useRoutineHeld(): ReadonlySet<string> {
  return useSyncExternalStore(
    (w) => {
      heldWatchers.add(w);
      return () => heldWatchers.delete(w);
    },
    () => held,
    () => held,
  );
}

// ------------------------------------------------------------------------------------- where each agent is

/** What the map last drew for each agent (activity and place), for panels outside the map. */
export interface LiveWhere {
  activity: string;
  place: string;
  note: string;
  at: number;
}
const where = new Map<string, LiveWhere>();
const whereWatchers = new Set<() => void>();
let whereVersion = 0;
export function publishWhere(personaId: string, w: LiveWhere) {
  const prev = where.get(personaId);
  if (prev && prev.activity === w.activity && prev.place === w.place && prev.note === w.note) return;
  where.set(personaId, w);
  whereVersion++;
  whereWatchers.forEach((f) => f());
}
export function useWhere(personaId: string): LiveWhere | null {
  useSyncExternalStore(
    (f) => {
      whereWatchers.add(f);
      return () => whereWatchers.delete(f);
    },
    () => whereVersion,
    () => whereVersion,
  );
  return where.get(personaId) ?? null;
}

// ------------------------------------------------------------------------------------- each agent's day

/**
 * Each named agent's planned day, as the map last worked it out (NamedAgents.tsx), so the office
 * inside a building ("Enter building") seats the same agents the city shows at their desks, even
 * while the map itself is paused behind it.
 */
let routinesNow: ReadonlyMap<string, Routine> = new Map();
const routineWatchers = new Set<() => void>();
export function publishRoutines(r: ReadonlyMap<string, Routine>) {
  if (routinesNow === r) return;
  routinesNow = r;
  routineWatchers.forEach((f) => f());
}
/** The routines now, outside React (review shots find real moments in them). */
export const routinesSnapshot = (): ReadonlyMap<string, Routine> => routinesNow;
/** Review shots only (visual/agent-fit.visual.ts): a routine drawn in place of an agent's own. Always empty in the app. */
export const routineOverride = new Map<string, Routine>();

export function useRoutines(): ReadonlyMap<string, Routine> {
  return useSyncExternalStore(
    (f) => {
      routineWatchers.add(f);
      return () => routineWatchers.delete(f);
    },
    () => routinesNow,
    () => routinesNow,
  );
}
