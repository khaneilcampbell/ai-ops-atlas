import type { TaskFilter } from "./select";

// A filter handed to the Task Center when another view opens it (a building on the map, an agent).
// The Task Center takes it once when it opens.
// A task id opens that task's details too (an agent's profile on the map links to its current task).
export type TaskFocus = Partial<TaskFilter> & { taskId?: string };
let pending: TaskFocus | null = null;

export function focusTasks(filter: Partial<TaskFilter>, taskId?: string) {
  pending = taskId ? { ...filter, taskId } : filter;
}

export function takeTaskFocus(): TaskFocus | null {
  const p = pending;
  pending = null;
  return p;
}
