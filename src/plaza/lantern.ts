/**
 * The glass lantern's night colour (Khaneil, 2026-11-18): the lantern is always lit at night, and its
 * colour says the plaza's status at a glance. The words on the sign and the "!" and check markers
 * still carry the same status, so nothing relies on colour alone.
 */
export const LANTERN = {
  /** The labelled sample preview: its own colour, so made-up examples never pass for live status. */
  preview: "#a77bff",
  /** A run just finished successfully: a brief green flash, only while the completion glow shows. */
  completed: "#3fd27a",
  /** No current agent-run or n8n data: a dim grey, never a guessed status. */
  unavailable: "#8c96a1",
  /** Something failed or waits on Khaneil. Outranks running. */
  attention: "#ff6f12",
  /** At least one real run in progress. */
  running: "#ffb30f",
  /** Connected, nothing running and nothing wrong: a soft warm white. */
  idle: "#ffe2a6",
} as const;

export type LanternState = keyof typeof LANTERN;

export function lanternState(v: { connection: "live" | "unavailable"; preview?: boolean; running: number; attention: number }, completing = false): LanternState {
  if (v.preview) return "preview";
  if (v.connection === "unavailable") return "unavailable";
  if (completing) return "completed";
  if (v.attention > 0) return "attention";
  if (v.running > 0) return "running";
  return "idle";
}
