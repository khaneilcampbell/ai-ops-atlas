import { useSyncExternalStore } from 'react';
import { emptyState, transition, type Command, type CommandState } from './model';
export const STORAGE_KEY = 'atlas:command-center:v1';
export function readState(raw: string | null): CommandState {
  if (!raw) return emptyState();
  const s = JSON.parse(raw) as CommandState;
  if (s.version !== 1 || ![s.agents, s.tasks, s.approvals, s.events].every(Array.isArray) ||
    s.agents.some(a => typeof a.id !== 'string' || typeof a.name !== 'string' || !Array.isArray(a.assignedProjects) || !Array.isArray(a.capabilities) || !Array.isArray(a.integrations)) ||
    s.tasks.some(t => t.executionMode !== 'simulation' || typeof t.id !== 'string')) throw new Error('Unsupported Command Center records.');
  return s;
}
let state = emptyState();
let error = '';
try { state = readState(localStorage.getItem(STORAGE_KEY)); } catch { error = 'Saved Command Center records could not be read. Changes are disabled to preserve them.'; }
const listeners = new Set<() => void>();
const subscribe = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };
export function dispatch(command: Command) {
  if (error) throw new Error(error);
  const next = transition(state, command);
  // Commit only after durable storage succeeds; never silently lose configuration.
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  state = next;
  listeners.forEach(fn => fn());
}
export function useCommand() { return { state: useSyncExternalStore(subscribe, () => state), error }; }
