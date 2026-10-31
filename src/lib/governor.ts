import { useSyncExternalStore } from "react";

/**
 * Keeps the 3D map smooth on any machine and any Performance setting by trading pixels for
 * frame time when frames run slow, and taking them back once there's room again.
 *
 * It only judges frames drawn back to back (camera moves, transitions), where the gap between
 * frames is the real cost of a frame. Idle frames are paced on purpose and say nothing.
 *
 * Levels, each a cap on top of the Performance setting (never above it):
 *   0  the setting as chosen
 *   1  pixel ratio at most 1.5
 *   2  pixel ratio 1, shadow map at most 2048
 *   3  pixel ratio 1, shadow map 1024
 *
 * Steps down after a second of slow frames (slower than 25 fps at the 75th percentile), at most
 * once every 2 s. Steps back up only after 10 s of fast frames (above 45 fps), so it doesn't
 * flicker between levels.
 */
export const LEVELS = [
  { maxDpr: Infinity, shadowMap: Infinity },
  { maxDpr: 1.5, shadowMap: Infinity },
  { maxDpr: 1, shadowMap: 2048 },
  { maxDpr: 1, shadowMap: 1024 },
] as const;

export const SLOW_MS = 40;
export const FAST_MS = 22;
const WINDOW = 30;
const DOWN_COOLDOWN_MS = 2000;
const UP_AFTER_MS = 10_000;
/** A gap this long is a pause (tab switch, breakpoint, timer-paced frame), not a slow frame. */
const PAUSE_MS = 250;

export interface GovernorState {
  level: number;
  samples: number[];
  changedAt: number;
  fastSince: number | null;
}

export const initialGovernor = (): GovernorState => ({ level: 0, samples: [], changedAt: -Infinity, fastSince: null });

function p75(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length * 0.75)];
}

/** Feeds one back-to-back frame gap (ms) at time `now`; returns the next state. Pure. */
export function step(st: GovernorState, gapMs: number, now: number): GovernorState {
  if (!(gapMs > 0) || gapMs > PAUSE_MS) return st;
  const samples = [...st.samples, gapMs].slice(-WINDOW);
  if (samples.length < WINDOW) return { ...st, samples };
  const t = p75(samples);
  if (t > SLOW_MS && st.level < LEVELS.length - 1 && now - st.changedAt >= DOWN_COOLDOWN_MS) {
    return { level: st.level + 1, samples: [], changedAt: now, fastSince: null };
  }
  if (t < FAST_MS && st.level > 0) {
    const fastSince = st.fastSince ?? now;
    if (now - fastSince >= UP_AFTER_MS) return { level: st.level - 1, samples: [], changedAt: now, fastSince: null };
    return { ...st, samples, fastSince };
  }
  return { ...st, samples, fastSince: t < FAST_MS ? st.fastSince : null };
}

// Shared so the map and its frame pacer agree; one map is on screen at a time.
let state = initialGovernor();
const listeners = new Set<() => void>();
export function feed(gapMs: number, now = performance.now()) {
  const next = step(state, gapMs, now);
  const changed = next.level !== state.level;
  state = next;
  if (changed) listeners.forEach((l) => l());
}
export function resetGovernor() {
  state = initialGovernor();
  listeners.forEach((l) => l());
}
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => void listeners.delete(l);
};
/** The current quality level, 0 (as set) to 3 (lightest). */
export function useQualityLevel(): number {
  return useSyncExternalStore(subscribe, () => state.level);
}
