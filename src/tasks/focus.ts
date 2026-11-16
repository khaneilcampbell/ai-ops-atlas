import type { TaskFilter } from "./select";

// A filter handed to the Task Center when another view opens it (a building on the map, an agent).
// The Task Center takes it once when it opens.
let pending: Partial<TaskFilter> | null = null;

export function focusTasks(filter: Partial<TaskFilter>) {
  pending = filter;
}

export function takeTaskFocus(): Partial<TaskFilter> | null {
  const p = pending;
  pending = null;
  return p;
}
