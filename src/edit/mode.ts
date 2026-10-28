import { useSyncExternalStore } from "react";

// The header's Edit switch. Off on every launch and every page load, so Atlas opens read-only
// and editing is always a deliberate step. Nothing is sent while it is on; it only shows the
// Edit buttons, and every save still goes through the review step and a pull request.

let on = false;
const listeners = new Set<() => void>();

export function setEditMode(next: boolean) {
  on = next;
  listeners.forEach((l) => l());
}

export function useEditMode(): boolean {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => on,
  );
}
