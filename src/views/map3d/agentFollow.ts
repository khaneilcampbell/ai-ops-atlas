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

/**
 * Which agents are inside their office building right now and on which floor (null in the lift),
 * as last drawn (NamedAgents.tsx). For the building summary and "Locate agent"; never a run state.
 */
export const agentInside = new Map<string, { key: string; level: number | null; seated: boolean } | null>();
