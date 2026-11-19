import { useSyncExternalStore } from "react";
import type { BuildingDefinition } from "./buildingDefinition";

/**
 * Which floor of each building the Inside view opens (buildingDefinition.ts). Shared by the cutaway
 * (InsideView), the characters (routinePose), the floor picker and "Locate agent", so all of them
 * agree on one floor. A building nobody picked a floor for opens at its default (the highest floor
 * with a desk). Presentation only: picking a floor never touches an agent's run.
 */
const picked = new Map<string, number>();
const watchers = new Set<() => void>();
let version = 0;
const notify = () => {
  version++;
  watchers.forEach((w) => w());
};

export function pickFloor(buildingId: string, floor: number | null) {
  if (floor === null ? !picked.has(buildingId) : picked.get(buildingId) === floor) return;
  if (floor === null) picked.delete(buildingId);
  else picked.set(buildingId, floor);
  notify();
}

/** The floor open in a building: the one picked, or its default. */
export function openFloor(buildingId: string, fallback: number): number {
  return picked.get(buildingId) ?? fallback;
}

export function pickedFloor(buildingId: string): number | undefined {
  return picked.get(buildingId);
}

/** Whether the map's Inside view is on, mirrored from the map for panels outside it. */
let shown = false;
export function setInsideShown(on: boolean) {
  if (shown === on) return;
  shown = on;
  notify();
}
export function insideShown() {
  return shown;
}

/** The building definitions of the map on screen (Map3D publishes them), for panels outside it. */
let buildings: ReadonlyMap<string, BuildingDefinition> = new Map();
export function setMapBuildings(defs: ReadonlyMap<string, BuildingDefinition>) {
  if (buildings === defs) return;
  buildings = defs;
  notify();
}
export function mapBuildings() {
  return buildings;
}

/** Re-renders on any floor change; returns a version number to key memos on. */
export function useInsideFloors(): number {
  return useSyncExternalStore(
    (w) => {
      watchers.add(w);
      return () => watchers.delete(w);
    },
    () => version,
    () => version,
  );
}

/** Tests only. */
export function resetInsideFloors() {
  picked.clear();
  notify();
}
