import { useSyncExternalStore } from "react";

/**
 * The one agent selection the map and the "City agents" panel share. Picking a character on the
 * map selects its row; picking a row selects the character (its marker gets a gold ring) without
 * moving the camera. While the panel is open it is the agent's only profile on the map: the
 * floating card stays closed, so two profiles never compete.
 */
interface State {
  selected: string | null;
  panelOpen: boolean;
}
let state: State = { selected: null, panelOpen: false };
const watchers = new Set<() => void>();
const set = (next: Partial<State>) => {
  const merged = { ...state, ...next };
  if (merged.selected === state.selected && merged.panelOpen === state.panelOpen) return;
  state = merged;
  watchers.forEach((w) => w());
};

export function selectCityAgent(personaId: string | null) {
  set({ selected: personaId });
}
export function setCityAgentsPanel(open: boolean) {
  set({ panelOpen: open });
}
export function cityAgentsState(): State {
  return state;
}
export function useCityAgents(): State {
  return useSyncExternalStore(
    (w) => {
      watchers.add(w);
      return () => watchers.delete(w);
    },
    () => state,
    () => state,
  );
}
