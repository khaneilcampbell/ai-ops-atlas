import { load, save } from "../lib/storage";

/**
 * City sound: the pure parts (saved preference, distance and stereo maths, which runtime changes
 * make a sound, and how overlapping sounds are limited). The Web Audio side is in engine.ts.
 */

export interface SoundPrefs {
  on: boolean;
  /** 0 to 1. */
  volume: number;
}

const PREFS_KEY = "citySound";
export const DEFAULT_PREFS: SoundPrefs = { on: false, volume: 0.6 };

/** First visit: muted. A saved choice is kept, with any odd value put back in range. */
export function loadSoundPrefs(): SoundPrefs {
  const saved = load<Partial<SoundPrefs> | null>(PREFS_KEY, null);
  if (!saved || typeof saved !== "object") return { ...DEFAULT_PREFS };
  const volume = typeof saved.volume === "number" && Number.isFinite(saved.volume) ? clamp01(saved.volume) : DEFAULT_PREFS.volume;
  return { on: saved.on === true, volume };
}

export function saveSoundPrefs(p: SoundPrefs) {
  save(PREFS_KEY, { on: p.on, volume: clamp01(p.volume) });
}

export const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/**
 * How loud a source is for its distance from the camera. Distances are measured against the
 * camera's own distance to what it looks at, so the place in the middle of the view sounds
 * near at any zoom and things far beyond it fade away.
 */
export function distanceGain(distance: number, viewDistance: number): number {
  const rel = distance / Math.max(1, viewDistance);
  // Full volume up to the focus, then an inverse-square style roll-off.
  return rel <= 0.8 ? 1 : 1 / (1 + 2.2 * (rel - 0.8) ** 2);
}

/** Left/right placement from a point in camera space (x to the right, -z ahead). */
export function stereoPan(camX: number, camZ: number): number {
  const ahead = Math.max(0.5, Math.abs(camZ));
  return Math.max(-0.85, Math.min(0.85, (camX / ahead) * 0.9));
}

/** Zoomed in close to the streets the traffic bed is fuller; from high above it is a soft hush. */
export function trafficLevel(viewDistance: number): number {
  if (viewDistance <= 20) return 1;
  if (viewDistance >= 200) return 0.45;
  return 1 - ((viewDistance - 20) / 180) * 0.55;
}

export type CityEventKind = "start" | "handoff" | "complete" | "attention";

export interface CityEvent {
  kind: CityEventKind;
  agentId?: string;
  projectId?: string;
  /** Play it at this map place (an anchor key, e.g. the Automation Plaza) instead of the agent's building. */
  anchorKey?: string;
}

/** The parts of an agent's runtime this needs (office/model.ts Runtime). */
export interface RuntimeLike {
  state: string;
  basis?: { result?: string } | null;
}

/** A start this soon after another agent in the same project finished counts as a handoff. */
export const HANDOFF_MS = 90_000;

/**
 * The sounds a change in agents' verified runtime states calls for. Only transitions Atlas
 * observed count: the first reading after load makes no sound, and a state that stays the same
 * stays quiet. `finished` remembers recent completions per project, for handoffs.
 */
export function eventsForRuntimes(
  prev: ReadonlyMap<string, RuntimeLike> | null,
  next: ReadonlyMap<string, RuntimeLike>,
  projectOf: (agentId: string) => string | undefined,
  finished: Map<string, { agentId: string; at: number }>,
  now: number,
): CityEvent[] {
  if (!prev) return [];
  const out: CityEvent[] = [];
  const completions: CityEvent[] = [];
  for (const [agentId, r] of next) {
    const before = prev.get(agentId);
    if (!before || before.state === r.state) continue;
    const projectId = projectOf(agentId);
    if (r.state === "working") {
      const last = projectId ? finished.get(projectId) : undefined;
      const handoff = !!last && last.agentId !== agentId && now - last.at <= HANDOFF_MS;
      out.push({ kind: handoff ? "handoff" : "start", agentId, projectId });
    } else if (r.state === "failed") {
      out.push({ kind: "attention", agentId, projectId });
    } else if (before.state === "working" && r.state === "idle" && r.basis?.result === "success") {
      completions.push({ kind: "complete", agentId, projectId });
    }
  }
  for (const c of completions) if (c.projectId) finished.set(c.projectId, { agentId: c.agentId ?? "", at: now });
  return [...out, ...completions];
}

/** Limits for the automation layer, so a burst of runs stays a few soft notes. */
export const LIMITS = {
  /** Event sounds allowed to ring at the same time. */
  voices: 3,
  /** How long one event sound rings, in ms. */
  ring: 1600,
  /** Repeats of the same kind within this window are softened... */
  repeatWindow: 6_000,
  /** ...by this much each... */
  repeatSoften: 0.55,
  /** ...and dropped after this many. */
  maxRepeats: 3,
  /** At most this many event sounds in any rolling `burstWindow`. */
  burst: 6,
  burstWindow: 20_000,
} as const;

/**
 * Decides whether an event sound may play now, and how softly. Returns 0 to skip it, otherwise a
 * gain multiplier (1 for the first of its kind, less for repeats).
 */
export class EventLimiter {
  private played: { kind: CityEventKind; at: number }[] = [];

  admit(kind: CityEventKind, now: number): number {
    this.played = this.played.filter((p) => now - p.at < LIMITS.burstWindow);
    const ringing = this.played.filter((p) => now - p.at < LIMITS.ring).length;
    if (ringing >= LIMITS.voices || this.played.length >= LIMITS.burst) return 0;
    const repeats = this.played.filter((p) => p.kind === kind && now - p.at < LIMITS.repeatWindow).length;
    if (repeats >= LIMITS.maxRepeats) return 0;
    this.played.push({ kind, at: now });
    return LIMITS.repeatSoften ** repeats;
  }

  reset() {
    this.played = [];
  }
}
