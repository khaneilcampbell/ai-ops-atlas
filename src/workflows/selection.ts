import { useSyncExternalStore } from "react";

// One shared selection for the 2D workflow and the 3D map. Selecting a node selects its building;
// selecting a building (from the map's inspector or the building list) clears the node and shows
// that building's steps. It's a tiny store outside React so the map never re-renders for it.

export interface WorkflowSelection {
  nodeId: string | null;
  buildingId: string | null;
}

let current: WorkflowSelection = { nodeId: null, buildingId: null };
const listeners = new Set<() => void>();

function set(next: WorkflowSelection) {
  if (next.nodeId === current.nodeId && next.buildingId === current.buildingId) return;
  current = next;
  listeners.forEach((l) => l());
}

export const selectNode = (nodeId: string | null, buildingId: string | null) => set({ nodeId, buildingId });
export const selectBuilding = (buildingId: string | null) => set({ nodeId: null, buildingId });
export const getWorkflowSelection = () => current;

export function useWorkflowSelection(): WorkflowSelection {
  return useSyncExternalStore(
    (fn) => (listeners.add(fn), () => void listeners.delete(fn)),
    () => current,
    () => current,
  );
}

// A run another view asked to open (Business goals link to the runs behind them). Read once.
let pendingRun: { goalId: string; runId: string } | null = null;
export const focusWorkflowRun = (goalId: string, runId: string) => void (pendingRun = { goalId, runId });
export function takeWorkflowRunFocus(): { goalId: string; runId: string } | null {
  const r = pendingRun;
  pendingRun = null;
  return r;
}
