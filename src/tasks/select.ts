import { OPEN } from "./lifecycle";
import type { StoredTask, TaskPriority, TaskSource, TaskStatus } from "./types";

// Derived views of the task list: the summary cards, filters, sorting, pages and per-building counts.

export interface TaskFilter {
  query: string;
  status: TaskStatus | "" | "open";
  priority: TaskPriority | "";
  agent: string;
  building: string;
  source: TaskSource | "";
  /** Inclusive dates (YYYY-MM-DD) on the task's creation day. */
  from: string;
  to: string;
}

export const EMPTY_FILTER: TaskFilter = { query: "", status: "", priority: "", agent: "", building: "", source: "", from: "", to: "" };

export interface TaskSummary {
  total: number;
  running: number;
  queued: number;
  awaitingApproval: number;
  failed: number;
  completed24h: number;
}

export function summarize(tasks: readonly StoredTask[], now = Date.now()): TaskSummary {
  const s: TaskSummary = { total: tasks.length, running: 0, queued: 0, awaitingApproval: 0, failed: 0, completed24h: 0 };
  for (const t of tasks) {
    if (t.status === "running") s.running++;
    else if (t.status === "queued") s.queued++;
    else if (t.status === "awaiting_approval") s.awaitingApproval++;
    else if (t.status === "failed") s.failed++;
    else if (t.status === "completed" && t.completedAt && now - Date.parse(t.completedAt) <= 86_400_000) s.completed24h++;
  }
  return s;
}

const day = (iso: string) => iso.slice(0, 10);

export function matches(t: StoredTask, f: TaskFilter): boolean {
  if (f.status === "open" ? !OPEN.has(t.status) : f.status && t.status !== f.status) return false;
  if (f.priority && t.priority !== f.priority) return false;
  if (f.agent && t.agentId !== f.agent) return false;
  if (f.building && t.buildingId !== f.building) return false;
  if (f.source && t.source !== f.source) return false;
  if (f.from && day(t.createdAt) < f.from) return false;
  if (f.to && day(t.createdAt) > f.to) return false;
  const q = f.query.trim().toLowerCase();
  if (q) {
    const hay = [t.title, t.description, t.objective, t.agentName, t.buildingName, t.workflow?.label, t.id].filter(Boolean).join(" ").toLowerCase();
    if (!q.split(/\s+/).every((w) => hay.includes(w))) return false;
  }
  return true;
}

const PRIORITY_RANK: Record<TaskPriority, number> = { critical: 0, high: 1, medium: 2, low: 3 };
const STATUS_RANK: Record<TaskStatus, number> = { running: 0, awaiting_approval: 1, failed: 2, blocked: 3, queued: 4, completed: 5, cancelled: 6 };

/** Work that needs attention first, then by priority, then newest. */
export function sortTasks(tasks: readonly StoredTask[]): StoredTask[] {
  return [...tasks].sort((a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status] || PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || b.updatedAt.localeCompare(a.updatedAt));
}

export const PAGE_SIZE = 25;
export function page<T>(rows: readonly T[], n: number, size = PAGE_SIZE): { rows: T[]; page: number; pages: number } {
  const pages = Math.max(1, Math.ceil(rows.length / size));
  const p = Math.min(Math.max(0, n), pages - 1);
  return { rows: rows.slice(p * size, p * size + size), page: p, pages };
}

/** When the last execution of a task started, if it ever ran. */
export const lastExecution = (t: StoredTask) => t.attempts[t.attempts.length - 1]?.startedAt ?? t.attempts[t.attempts.length - 1]?.requestedAt;

export interface BuildingTaskSummary {
  assigned: number;
  running: number;
  blocked: number;
  failed: number;
  /** The newest task change in the building. */
  lastActivity: string | null;
}

/** Counts for one building's map inspector. "Assigned" means still open. */
export function buildingSummary(tasks: readonly StoredTask[], buildingId: string): BuildingTaskSummary {
  const s: BuildingTaskSummary = { assigned: 0, running: 0, blocked: 0, failed: 0, lastActivity: null };
  for (const t of tasks) {
    if (t.buildingId !== buildingId) continue;
    if (OPEN.has(t.status)) s.assigned++;
    if (t.status === "running") s.running++;
    if (t.status === "blocked" || t.status === "awaiting_approval") s.blocked++;
    if (t.status === "failed") s.failed++;
    if (!s.lastActivity || t.updatedAt > s.lastActivity) s.lastActivity = t.updatedAt;
  }
  return s;
}
