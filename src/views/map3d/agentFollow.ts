import { useSyncExternalStore } from "react";
import { wake } from "../../lib/power";

/**
 * "Follow agent": the camera keeps one named agent in view as it walks, rides or works. The
 * characters (NamedAgents.tsx) publish where each one is drawn; the camera rig (Map3D.tsx) glides
 * after the followed one and lets go as soon as the person moves the camera themselves.
 */
let followed: string | null = null;
const watchers = new Set<() => void>();
/** Where each agent was last drawn (world x, y, z), or null while it's out of sight (home, terminal). */
export const agentPositions = new Map<string, [number, number, number] | null>();

export function setFollowedAgent(personaId: string | null) {
  if (followed === personaId) return;
  followed = personaId;
  // Start drawing so the camera can glide over (the map draws on demand when idle).
  if (personaId) wake(300);
  watchers.forEach((w) => w());
}
export function followedAgent(): string | null {
  return followed;
}
export function useFollowedAgent(): string | null {
  return useSyncExternalStore(
    (w) => {
      watchers.add(w);
      return () => watchers.delete(w);
    },
    () => followed,
    () => followed,
  );
}

/** Ask the map to open an agent's office in the Inside view and frame it (Map.tsx listens). */
export const VIEW_OFFICE_EVENT = "atlas:view-office";
export interface ViewOfficeDetail {
  projectId: string | null;
  towerKey: string | null;
  /** "Locate agent": open its floor and keep it in view (buildings/insideFloors.ts). */
  personaId?: string;
  floor?: number;
  /** A drawn place with a room to look into (the café, "service:community-cafe"): selected and framed close. */
  service?: string;
}
export function viewOffice(detail: ViewOfficeDetail) {
  window.dispatchEvent(new CustomEvent<ViewOfficeDetail>(VIEW_OFFICE_EVENT, { detail }));
}

/** Back to the city: the Inside view closes and every building shows its exterior again (Map.tsx listens). */
export const LEAVE_INSIDE_EVENT = "atlas:leave-inside";
export function leaveInside() {
  window.dispatchEvent(new CustomEvent(LEAVE_INSIDE_EVENT));
}
