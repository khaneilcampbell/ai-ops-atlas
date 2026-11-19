import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useN8nRuns } from "../n8n/runs";
import { useAtlas } from "../state";
import { useTasks } from "../tasks/store";
import { useRuns } from "../workflows/runs";
import { useRuntimes } from "../views/office/activity";
import { plazaEvents, plazaSnapshot, previewSnapshot, type PlazaEvent, type PlazaSnapshot, type RuntimeLike } from "./plazaState";

// The sample preview is a session-only switch, off on every load, so live mode is always the default.
let preview = false;
const watchers = new Set<() => void>();
export function setPlazaPreview(on: boolean) {
  preview = on;
  watchers.forEach((w) => w());
}
export function usePlazaPreview(): boolean {
  return useSyncExternalStore(
    (w) => {
      watchers.add(w);
      return () => watchers.delete(w);
    },
    () => preview,
    () => preview,
  );
}

/** Re-reads freshness once a minute, so a summary that ages past its limit turns stale on screen. */
function useMinute(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);
  return now;
}

/** How often the sample preview changes, and fires a sample handoff or completion. */
export const PREVIEW_STEP_MS = 6_000;

/**
 * The plaza's snapshot from the live sources (or the labelled sample preview). Pass the map's
 * runtimes when it already has them, so the work isn't done twice.
 */
export function usePlazaSnapshot(runtimes?: ReadonlyMap<string, RuntimeLike>): PlazaSnapshot {
  const { catalog } = useAtlas();
  const own = useRuntimes();
  const rt = runtimes ?? own;
  const tasks = useTasks();
  const runs = useRuns();
  const n8n = useN8nRuns();
  const on = usePlazaPreview();
  const minute = useMinute();
  const [phase, setPhase] = useState(0);
  useEffect(() => {
    if (!on) return;
    const t = setInterval(() => setPhase((p) => p + 1), PREVIEW_STEP_MS);
    return () => clearInterval(t);
  }, [on]);
  const projectNames = useMemo(() => new Map(catalog.projects.map((p) => [p.id, p.name])), [catalog]);
  const live = useMemo(
    () => plazaSnapshot({ agents: catalog.agents, projectNames, runtimes: rt, tasks, runs, n8n, now: Date.now() }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- minute re-checks freshness
    [catalog.agents, projectNames, rt, tasks, runs, n8n, minute],
  );
  const sample = useMemo(() => (on ? previewSnapshot(catalog.agents, projectNames, Date.now(), phase) : null), [on, catalog.agents, projectNames, phase]);
  return sample ?? live;
}

export interface PlazaPulse {
  id: string;
  buildingKey: string;
  at: number;
}

export interface PlazaEffects {
  pulses: PlazaPulse[];
  /** performance.now() when the latest completion glow started, or null. */
  glowAt: number | null;
  /** Every event as it fires, for the screen-reader line. */
  last: PlazaEvent | null;
}

export const PULSE_MS = 2_400;
export const GLOW_MS = 2_600;
/** At most this many pulses travel at once; more simultaneous handoffs wait their turn quietly. */
export const MAX_PULSES = 3;

/**
 * Turns snapshot changes into short-lived plaza effects: a pulse per handoff (only to a building
 * the map knows), a brief green glow per completion. Each event fires once, and every effect
 * clears itself.
 */
export function usePlazaEffects(snapshot: PlazaSnapshot, hasBuilding: (key: string) => boolean): PlazaEffects {
  const [pulses, setPulses] = useState<PlazaPulse[]>([]);
  const [glowAt, setGlowAt] = useState<number | null>(null);
  const [last, setLast] = useState<PlazaEvent | null>(null);
  const prev = useRef<PlazaSnapshot | null>(null);
  const seen = useRef(new Map<string, number>());
  const recent = useRef(new Map<string, { agentId?: string; at: number }>());
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  const has = useRef(hasBuilding);
  has.current = hasBuilding;

  useEffect(() => {
    const later = (fn: () => void, ms: number) => {
      const t = setTimeout(() => {
        timers.current.delete(t);
        fn();
      }, ms);
      timers.current.add(t);
    };
    const pulse = (id: string, key: string) => {
      const p = { id, buildingKey: key, at: performance.now() };
      setPulses((ps) => (ps.length >= MAX_PULSES || ps.some((x) => x.id === id) ? ps : [...ps, p]));
      later(() => setPulses((ps) => ps.filter((x) => x.id !== id)), PULSE_MS);
    };
    const glow = () => {
      const at = performance.now();
      setGlowAt(at);
      later(() => setGlowAt((g) => (g === at ? null : g)), GLOW_MS);
    };

    let events: PlazaEvent[];
    if (snapshot.preview) {
      // The sample preview alternates a sample handoff and a sample completion on each step.
      const p = prev.current?.preview ? prev.current : null;
      const first = snapshot.running[0];
      events = p && first ? [{ key: `preview:${first.id}`, kind: Number(first.id.split(":").pop()) % 2 ? "complete" : "handoff", itemId: first.id, source: "task", agentId: first.agentId, buildingKey: first.buildingKey }] : [];
    } else events = plazaEvents(prev.current, snapshot, seen.current, recent.current, Date.now());
    prev.current = snapshot;

    for (const e of events) {
      if (e.kind === "handoff" && e.buildingKey && has.current(e.buildingKey)) pulse(e.key, e.buildingKey);
      if (e.kind === "complete") glow();
      setLast(e);
    }
  }, [snapshot]);

  useEffect(() => {
    const all = timers.current;
    return () => {
      for (const t of all) clearTimeout(t);
      all.clear();
    };
  }, []);

  return { pulses, glowAt, last };
}
