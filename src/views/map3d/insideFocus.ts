import { useSyncExternalStore } from "react";
import { wake } from "../../lib/power";
import { load, save } from "../../lib/storage";

/**
 * "View inside": the one building opened as a cutaway on purpose, which floor it shows, and the
 * agent being located in it. Separate from the toolbar's Inside switch (which opens whatever is
 * near): this opens exactly the building asked for, whatever the camera distance, and closes it
 * again with "Back to city". Kept across a reload, so a refresh comes back to the same floor.
 *
 * Only what is shown lives here. Opening a building, changing floor or locating an agent never
 * touches a run: the agents' places come from their routine and their state from real runs.
 */
export interface InsideFocus {
  /** Tower key (project:…). */
  key: string;
  /** Floor shown; null: the lowest floor with desks. */
  level: number | null;
  /** The agent "Locate agent" asked for, if any. */
  agentId: string | null;
}

const KEY = "mapInsideFocus";
let focus: InsideFocus | null = (() => {
  const f = load<InsideFocus | null>(KEY, null);
  return f && typeof f.key === "string" ? { key: f.key, level: typeof f.level === "number" ? f.level : null, agentId: typeof f.agentId === "string" ? f.agentId : null } : null;
})();
/** A camera move the map should make once: frame a building at a floor, or a point in it. Consumed by Map3D. */
export interface InsideFrame {
  key: string;
  level: number | null;
  at?: { x: number; y: number; z: number };
  dist?: number;
}
// After a reload, glide back to the building that was open.
let frame: InsideFrame | null = focus ? { key: focus.key, level: focus.level } : null;
const watchers = new Set<() => void>();

function set(next: InsideFocus | null) {
  focus = next;
  save(KEY, next);
  wake(400);
  watchers.forEach((w) => w());
}

/** Open a building as a cutaway, optionally at a floor, and glide the camera to it. */
export function viewInside(key: string, level: number | null = null, agentId: string | null = null, at?: { x: number; y: number; z: number; dist?: number }) {
  frame = { key, level, at: at && { x: at.x, y: at.y, z: at.z }, dist: at?.dist };
  set({ key, level, agentId });
}
/** Show another floor of the open building. */
export function setInsideLevel(level: number) {
  if (!focus) return;
  frame = { key: focus.key, level };
  set({ ...focus, level, agentId: null });
}
/** Close the cutaway and go back to the normal city view. */
export function leaveInside() {
  if (focus) set(null);
}
export function insideFocus(): InsideFocus | null {
  return focus;
}
export function takeInsideFrame(): InsideFrame | null {
  const f = frame;
  frame = null;
  return f;
}
export function useInsideFocus(): InsideFocus | null {
  return useSyncExternalStore(
    (w) => {
      watchers.add(w);
      return () => watchers.delete(w);
    },
    () => focus,
    () => focus,
  );
}
