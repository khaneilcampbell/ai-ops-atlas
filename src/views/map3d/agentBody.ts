import { CITY_FIGURES } from "../../registry/cityFigures";
import { FIGURE_SCALE, RIG } from "./agentFigures";

/**
 * The named agents' real body size on the map, world units: the reference every space they use is
 * fitted to (Ferris wheel cabins, the yacht's deck, office chairs, doors, platforms). Measured from
 * the rig (agentFigures.ts RIG) at FIGURE_SCALE for the tallest and broadest agent in the team
 * (registry/cityFigures.ts), so a space that fits these fits everyone.
 *
 * The portrait badge floats above the head (RIG.top + its lift) and is never part of the body: it
 * takes no part in collision, doorway or cabin clearance.
 *
 * One scale only: poseBones applies the figure's scale once at its root, so a seat or anchor is
 * given in world units and never multiplied by a parent's scale again.
 */
const builds = Object.values(CITY_FIGURES).map((f) => f.build);
const tallest = Math.max(1, ...builds.map((b) => b.height));
const broadest = Math.max(1, ...builds.map((b) => b.shoulders));
const k = FIGURE_SCALE * tallest;

export const AGENT_BODY = {
  /** Feet to the top of the head, standing. */
  standingHeight: RIG.top * k,
  /** Across the arms at the shoulders (the widest part of the body). */
  shoulderWidth: (2 * RIG.arm.x * broadest + RIG.arm.w) * k,
  /** Front to back, standing (torso depth). */
  depth: RIG.torso.d * k,
  /** Hip joint above the feet: the seat height the rig sits at (its legs swing level from here). */
  hipHeight: RIG.leg.h * k,
  /** Seat surface to the top of the head, seated. */
  seatedHeight: (RIG.top - RIG.leg.h) * k,
  /** Seated, front to back: the back of the torso to the feet (legs level, forward of the hip). */
  seatedDepth: (RIG.torso.d / 2 + RIG.leg.h + RIG.leg.d / 2) * k,
  /** Space kept clear above the head and at each shoulder in a doorway, cabin or under a deck. */
  clearance: 0.04,
} as const;

/** Clear height a space needs for an agent to stand in it. */
export const standingClearHeight = AGENT_BODY.standingHeight + AGENT_BODY.clearance;
/** Clear width for one agent to pass (a doorway, a gangway, a cabin door). */
export const passWidth = AGENT_BODY.shoulderWidth + 2 * AGENT_BODY.clearance;
/** Clear height above a seat surface for a seated agent. */
export const seatedClearHeight = AGENT_BODY.seatedHeight + AGENT_BODY.clearance;
/** Seat surfaces sit at the hip height, so a seated agent's legs rest level, neither in the floor nor dangling. */
export const SEAT_HEIGHT = AGENT_BODY.hipHeight;

/**
 * Where to stand a seated figure so its hips rest on a seat surface at `seatY`: the rig's origin is
 * its feet, and sitting swings the legs forward from the hip, which stays at hipHeight x scale.
 */
export function seatedOrigin(seatY: number, scale: number): number {
  return seatY - RIG.leg.h * scale;
}
