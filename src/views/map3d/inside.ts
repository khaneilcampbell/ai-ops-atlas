import type { PowerMode } from "../../lib/power";
import { load, save } from "../../lib/storage";

/**
 * The map's Inside view: headquarters open up as cutaways so their offices show without
 * entering. Detail follows distance, so the map stays inside its frame and geometry budget:
 *
 * - near: the shell is cut away above the floor and the office is drawn inside, desks, chairs,
 *   the agents and their status lamps, from the same plan and the same verified state as the
 *   office itself;
 * - mid: the shell is cut away and the floor shows as a plan, one tile per desk in its state's color;
 * - far: the building keeps its exterior.
 *
 * Pure, so the choice of buildings and the saved preference can be tested without WebGL.
 */

/** The saved toolbar choice. Off unless KC turned it on. */
export const INSIDE_KEY = "mapInside";
export function loadInside(): boolean {
  return load<boolean>(INSIDE_KEY, false) === true;
}
export function saveInside(on: boolean) {
  save(INSIDE_KEY, on);
}

export interface InsideLimits {
  /** Most buildings drawn with their full office at once. */
  near: number;
  /** Most buildings with a floor-plan proxy, on top of the near ones. */
  mid: number;
  /** Camera distance (world units) within which a building can be near. */
  nearDist: number;
  /** Camera distance within which a building can show its floor plan. */
  midDist: number;
}

/**
 * How much Inside draws, by device and the Performance setting. The total stays within the
 * shader's cut slots (CUT_MAX, 16); a phone or Battery saver opens fewer buildings and only
 * one office at a time.
 */
export function insideLimits(phone: boolean, mode: PowerMode, onBattery: boolean | null): InsideLimits {
  const saver = mode === "saver" || (mode === "auto" && onBattery === true);
  // Distances are camera to building: the whole city fits at about 280, a selected building at
  // about 55, zoomed in on a building about 30.
  if (phone) return { near: 1, mid: 7, nearDist: 45, midDist: Infinity };
  if (saver) return { near: 1, mid: 9, nearDist: 45, midDist: Infinity };
  if (mode === "full") return { near: 4, mid: 12, nearDist: 70, midDist: Infinity };
  return { near: 3, mid: 13, nearDist: 60, midDist: Infinity };
}

export interface InsideCandidate {
  key: string;
  x: number;
  y: number;
  z: number;
}

export interface InsideTiers {
  near: string[];
  mid: string[];
}

/** A building already in a tier keeps it until it is this much past the limit, so it doesn't flicker at the edge. */
const HOLD = 1.15;

/**
 * Picks the near and mid buildings: only those in view, nearest first, the selected building
 * (`prefer`) ahead of the rest when it is in view and close enough. `prev` lets a building stay
 * in its tier a little past the threshold while the camera hovers at the edge.
 */
export function pickInside(cands: InsideCandidate[], cam: { x: number; y: number; z: number }, inView: (c: InsideCandidate) => boolean, limits: InsideLimits, prev?: InsideTiers, prefer?: string | null): InsideTiers {
  const was = (k: string, tier: "near" | "mid") => !!prev?.[tier].includes(k);
  const ranked = cands
    .filter(inView)
    .map((c) => ({ c, d: Math.hypot(c.x - cam.x, c.y - cam.y, c.z - cam.z) }))
    .sort((a, b) => Number(b.c.key === prefer) - Number(a.c.key === prefer) || a.d - b.d || a.c.key.localeCompare(b.c.key));
  const near: string[] = [];
  const mid: string[] = [];
  for (const { c, d } of ranked) {
    if (near.length < limits.near && d <= limits.nearDist * (was(c.key, "near") ? HOLD : 1)) near.push(c.key);
    else if (mid.length < limits.mid && d <= limits.midDist * (was(c.key, "mid") || was(c.key, "near") ? HOLD : 1)) mid.push(c.key);
  }
  return { near, mid };
}

export function sameTiers(a: InsideTiers, b: InsideTiers) {
  return a.near.join() === b.near.join() && a.mid.join() === b.mid.join();
}

/**
 * Scale from office units (a desk is 1.5 wide) to the map, so the whole office plan fits in the
 * building's footprint with a margin for its walls.
 */
export function officeScale(plan: { w: number; d: number }, footprint: number) {
  return (footprint * 0.86) / Math.max(plan.w + 0.32, plan.d + 0.32);
}

/** Eases a cut height toward its target; returns the new height. Instant with reduced motion. */
export function stepCut(cur: number, target: number, span: number, dt: number, reduced: boolean, ms = 450) {
  if (reduced || span <= 0) return target;
  const step = (span * dt * 1000) / ms;
  return Math.abs(target - cur) <= step ? target : cur + Math.sign(target - cur) * step;
}
