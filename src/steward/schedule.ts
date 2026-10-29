import type { StewardRun } from "./check";

export interface StewardSchedule { enabled: boolean; time: string; lastAttemptDay?: string }
export const DEFAULT_SCHEDULE: StewardSchedule = { enabled: false, time: "09:00" };
export const validTime = (time: unknown): time is string => typeof time === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(time);
export function localDay(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
export function due(schedule: StewardSchedule, now: Date): boolean {
  if (!schedule.enabled || !validTime(schedule.time) || schedule.lastAttemptDay === localDay(now)) return false;
  const [hour, minute] = schedule.time.split(":").map(Number);
  return now.getHours() * 60 + now.getMinutes() >= hour * 60 + minute;
}
export function nextCheck(schedule: StewardSchedule, now = new Date()): string {
  if (!schedule.enabled) return "Off · manual checks only";
  if (due(schedule, now)) return "Due today · checks when Atlas is open";
  const next = new Date(now);
  const [hour, minute] = schedule.time.split(":").map(Number);
  next.setHours(hour, minute, 0, 0);
  if (next <= now || schedule.lastAttemptDay === localDay(now)) next.setDate(next.getDate() + 1);
  return `${next.toLocaleString()} · device time · while Atlas is open`;
}
/** Ignore commit churn and healthy sample-size changes; track actionable changes and coverage loss/recovery. */
export function changedChecks(previous: StewardRun | undefined, next: StewardRun): string[] {
  if (next.status === "paused" || next.status === "failed") return [];
  const before = new Map(previous?.checks.filter((c) => c.id !== "commit").map((c) => [c.id, c]));
  return next.checks.filter((c) => {
    if (c.id === "commit") return false;
    const old = before.get(c.id);
    if (!old) return c.state !== "clear";
    return old.state !== c.state || (c.state !== "clear" && (old.detail !== c.detail || old.signature !== c.signature));
  }).map((c) => c.label);
}
