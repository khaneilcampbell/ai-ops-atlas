import { useSyncExternalStore } from "react";

/**
 * Which building's office is open, and where the transition is. A tiny external store so the
 * inspector, the map camera and the office layer can share it without threading props through
 * the map. Phases: "entering" while the map camera glides in and the office fades up, "inside"
 * once the map is covered (and paused), "leaving" while the office fades out and the map camera
 * glides back.
 */
export type OfficePhase = "entering" | "inside" | "leaving";
export interface OfficeState {
  projectId: string | null;
  phase: OfficePhase | null;
}

/** How long each half of the transition takes; the CSS fade matches it. */
export const ENTER_MS = 900;
export const LEAVE_MS = 520;

let state: OfficeState = { projectId: null, phase: null };
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setTimeout> | undefined;

function set(next: OfficeState) {
  state = next;
  listeners.forEach((l) => l());
}

export function enterBuilding(projectId: string, instant = false) {
  if (projectId === "skyline") { projectId = "skyline-residences"; instant = true; }
  clearTimeout(timer);
  if (instant) return set({ projectId, phase: "inside" });
  set({ projectId, phase: "entering" });
  timer = setTimeout(() => set({ projectId, phase: "inside" }), ENTER_MS);
}

export function leaveBuilding(instant = false) {
  clearTimeout(timer);
  if (!state.projectId) return;
  if (instant) return set({ projectId: null, phase: null });
  set({ ...state, phase: "leaving" });
  timer = setTimeout(() => set({ projectId: null, phase: null }), LEAVE_MS);
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export function useOffice(): OfficeState {
  return useSyncExternalStore(subscribe, () => state);
}
