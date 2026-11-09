import * as THREE from "three";
import type { ScrollMode } from "../../lib/navigation";

/**
 * Mac trackpad navigation for the 3D map, as plain functions so the mapping from input to camera
 * is tested without a browser.
 *
 * Gestures, on any Mac trackpad (or Magic Mouse):
 * - two-finger scroll moves the map. The ground under the fingers follows them, and the Mac's
 *   own "natural scrolling" setting decides the direction, as everywhere else on the Mac.
 * - pinch zooms around the point between the fingers. Chrome and Firefox report a pinch as a
 *   wheel event with ctrlKey set; Safari and the Mac app (WebKit) report GestureEvents with a
 *   scale and a rotation. Both are handled, and a ctrl wheel during a WebKit gesture is dropped
 *   so a pinch never zooms twice.
 * - twisting two fingers (WebKit only) turns the map with them, after a small dead zone so a
 *   pinch doesn't wobble.
 * - Option with a scroll turns (sideways) and tilts (up and down) the view, with a trackpad or
 *   a mouse wheel.
 * - a plain mouse wheel still zooms to the cursor through MapControls, unchanged.
 *
 * Inertia is the Mac's own: after a flick macOS keeps sending scroll events that slow down.
 * Atlas adds no easing of its own on top. Those trailing events are dropped once the person
 * clicks, drags or picks something that glides the camera, so a flick can't fight a selection.
 */

/** Sensitivity, in one place. Multiplied by the Trackpad speed setting. */
export const TUNING = {
  /** Pan: ground moved per scroll pixel, as a share of what keeps it exactly under the fingers. */
  pan: 1,
  /** Pinch through ctrl wheel: zoom factor is exp(-deltaY * pinch). 0.01 tracks the fingers 1:1 in Chrome. */
  pinch: 0.01,
  /** Largest zoom step one event can make, so a held ctrl with a mouse wheel can't jump. */
  maxStep: 2,
  /** Option-scroll: radians turned per pixel sideways, and tilted per pixel up or down. */
  orbit: 0.005,
  tilt: 0.004,
  /** Twist dead zone, degrees, before rotation starts during a pinch. */
  twistDeadZone: 8,
  /** Wheel events closer together than this belong to the same gesture (momentum included). */
  sessionGapMs: 350,
  /** Pans can't take the point looked at further than this beyond the island's edge. */
  edgeMargin: 12,
} as const;

export type WheelKind = "trackpad" | "mouse";

/** The parts of a WheelEvent this module reads. */
export interface WheelSample {
  deltaX: number;
  deltaY: number;
  deltaMode: number;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  timeStamp: number;
}

export type WheelIntent =
  /** Let MapControls zoom to the cursor, as for any mouse wheel. */
  | { kind: "pass" }
  /** Swallow it: the tail of a flick after the person did something else, or a duplicate pinch. */
  | { kind: "drop" }
  | { kind: "pan"; dx: number; dy: number }
  | { kind: "zoom"; factor: number }
  | { kind: "orbit"; azimuth: number; polar: number };

// Chrome on a Mac scrolls a mouse wheel in multiples of this many pixels.
const CHROME_MOUSE_STEP = 4.000244140625;

/** What a single event proves about the device, if anything. */
export function evidence(e: WheelSample): WheelKind | null {
  if (e.deltaMode !== 0) return "mouse"; // lines or pages: a notched wheel (Firefox)
  if (e.deltaX !== 0 && !e.shiftKey) return "trackpad"; // a mouse wheel never moves sideways on its own
  if (e.deltaY !== 0 && Math.abs(e.deltaY) % CHROME_MOUSE_STEP === 0) return "mouse";
  return null;
}

/**
 * Tells trackpad from mouse wheel per gesture. A gesture is a run of events with no long gap, so
 * macOS momentum stays part of the flick that started it. Hard evidence (sideways movement,
 * line deltas, Chrome's wheel step, a pinch) is remembered for later gestures with no evidence
 * of their own; until there is any, a Mac assumes a trackpad and anything else a mouse.
 *
 * Limit: WebKit (Safari and the Mac app) reports a straight-down trackpad scroll and a mouse
 * wheel the same way, so after a mouse has been proven, a perfectly vertical trackpad scroll
 * with no sideways jitter can read as a wheel until the next sideways movement. The Map
 * navigation setting overrides the guess for anyone who sees that.
 */
export class WheelClassifier {
  private session: { last: number; kind: WheelKind; stale: boolean } | null = null;
  constructor(private remembered: WheelKind) {}

  classify(e: WheelSample): { kind: WheelKind; stale: boolean } {
    const proof = evidence(e);
    if (proof) this.remembered = proof;
    const s = this.session;
    if (!s || e.timeStamp - s.last > TUNING.sessionGapMs) {
      // A wheel notch arrives as one big step; a trackpad starts small as the fingers speed up.
      const kind = proof ?? (Math.abs(e.deltaY) >= 100 ? "mouse" : this.remembered);
      this.session = { last: e.timeStamp, kind, stale: false };
    } else {
      s.last = e.timeStamp;
      if (proof === "trackpad") s.kind = "trackpad";
    }
    return { kind: this.session!.kind, stale: this.session!.stale };
  }

  /** The person clicked, dragged or started a glide: ignore the rest of the current flick. */
  interrupt() {
    if (this.session) this.session.stale = true;
  }

  /** Only a trackpad pinches. */
  sawPinch() {
    this.remembered = "trackpad";
  }
}

/** Pixels, whatever unit the event used. */
export function pixels(e: Pick<WheelSample, "deltaX" | "deltaY" | "deltaMode">, pageH = 800): { dx: number; dy: number } {
  const k = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? pageH : 1;
  return { dx: e.deltaX * k, dy: e.deltaY * k };
}

/**
 * What a wheel event should do to the map.
 * `gesturing`: a WebKit pinch is in progress, which already zooms.
 */
export function wheelIntent(e: WheelSample, c: WheelClassifier, mode: ScrollMode, speed: number, gesturing: boolean, pageH = 800): WheelIntent {
  const { kind, stale } = c.classify(e);
  const { dx, dy } = pixels(e, pageH);
  if (e.ctrlKey) {
    if (gesturing) return { kind: "drop" };
    if (kind === "trackpad") c.sawPinch();
    const f = Math.exp(-dy * TUNING.pinch * speed);
    return { kind: "zoom", factor: THREE.MathUtils.clamp(f, 1 / TUNING.maxStep, TUNING.maxStep) };
  }
  if (stale) return { kind: "drop" };
  if (e.altKey) return { kind: "orbit", azimuth: dx * TUNING.orbit * speed, polar: dy * TUNING.tilt * speed };
  const pan = mode === "pan" || (mode === "auto" && kind === "trackpad");
  if (!pan) return { kind: "pass" };
  return { kind: "pan", dx: dx * TUNING.pan * speed, dy: dy * TUNING.pan * speed };
}

/** A Mac with a trackpad as its likely pointer: not an iPad, whose fingers MapControls already handles. */
export function likelyMacTrackpad(nav: { platform?: string; userAgent?: string; maxTouchPoints?: number } | undefined): boolean {
  if (!nav) return false;
  const mac = /Mac/.test(nav.platform ?? "") || /Macintosh/.test(nav.userAgent ?? "");
  return mac && (nav.maxTouchPoints ?? 0) === 0;
}

/**
 * The twist of a WebKit gesture to apply now, in degrees, with a dead zone: nothing until the
 * total twist passes it, then everything beyond it, so turning starts smoothly from zero.
 */
export function twistStep(prevTotal: number, total: number, deadZone = TUNING.twistDeadZone): number {
  const beyond = (r: number) => Math.sign(r) * Math.max(0, Math.abs(r) - deadZone);
  return beyond(total) - beyond(prevTotal);
}

// ---------------------------------------------------------------------------------------------
// Camera moves. The rig is the point looked at and the camera position; the camera always faces
// the point (MapControls turns it on its next update), so moving both keeps the angle.

export interface Rig {
  target: THREE.Vector3;
  position: THREE.Vector3;
}

const UP = new THREE.Vector3(0, 1, 0);

/**
 * Slide the view along the ground by a scroll of (dx, dy) pixels. Positive dy (fingers up, with
 * natural scrolling) pushes the ground up the screen; positive dx pushes it left. One pixel moves
 * the ground under the point looked at by one pixel, so the map stays under the fingers.
 */
export function panRig(rig: Rig, fovDeg: number, viewportH: number, dx: number, dy: number) {
  const offset = rig.position.clone().sub(rig.target);
  const d = offset.length();
  const perPx = (2 * d * Math.tan((fovDeg * Math.PI) / 360)) / Math.max(1, viewportH);
  const forward = new THREE.Vector3(-offset.x, 0, -offset.z);
  if (forward.lengthSq() < 1e-9) forward.set(0, 0, -1);
  forward.normalize();
  const right = new THREE.Vector3().crossVectors(forward, UP);
  // A pixel up the screen covers more ground the flatter the view.
  const elevation = Math.max(0.25, offset.y / d);
  const move = right.multiplyScalar(dx * perPx).addScaledVector(forward, -(dy * perPx) / elevation);
  rig.target.add(move);
  rig.position.add(move);
}

/**
 * Zoom by `factor` (above 1 is closer) around `anchor`, a point on the ground under the cursor,
 * which stays under the cursor. The whole rig scales around it, so the angle doesn't change.
 * Distance stays within [min, max].
 */
export function zoomRigAt(rig: Rig, anchor: THREE.Vector3 | null, factor: number, min: number, max: number) {
  const d = rig.position.distanceTo(rig.target);
  if (d < 1e-6 || factor <= 0) return;
  const s = THREE.MathUtils.clamp(d / factor, min, max) / d;
  const p = (anchor ?? rig.target).clone();
  rig.target.sub(p).multiplyScalar(s).add(p);
  rig.position.sub(p).multiplyScalar(s).add(p);
}

/**
 * Turn the view around the point looked at by `azimuth` radians (positive: the ground in front
 * moves left with the fingers) and tilt by `polar` (positive: toward the horizon), within the
 * same polar limits as the controls.
 */
export function orbitRig(rig: Rig, azimuth: number, polar: number, minPolar: number, maxPolar: number) {
  const s = new THREE.Spherical().setFromVector3(rig.position.clone().sub(rig.target));
  s.theta += azimuth;
  s.phi = THREE.MathUtils.clamp(s.phi + polar, minPolar, maxPolar);
  s.makeSafe();
  rig.position.copy(rig.target).add(new THREE.Vector3().setFromSpherical(s));
}

/** Keep the point looked at over the island plus a margin, moving the camera with it. */
export function clampRig(rig: Rig, b: { x0: number; x1: number; z0: number; z1: number }, margin = TUNING.edgeMargin) {
  const x = THREE.MathUtils.clamp(rig.target.x, b.x0 - margin, b.x1 + margin);
  const z = THREE.MathUtils.clamp(rig.target.z, b.z0 - margin, b.z1 + margin);
  const fix = new THREE.Vector3(x - rig.target.x, 0, z - rig.target.z);
  rig.target.add(fix);
  rig.position.add(fix);
}

/**
 * The point on the level of the point looked at that is under the screen point (ndcX, ndcY),
 * or null when that is sky or so far off that zooming around it would fling the view.
 */
export function groundAt(camera: THREE.Camera, target: THREE.Vector3, ndcX: number, ndcY: number): THREE.Vector3 | null {
  const ray = new THREE.Raycaster();
  camera.updateMatrixWorld();
  ray.setFromCamera(new THREE.Vector2(ndcX, ndcY), camera);
  const hit = ray.ray.intersectPlane(new THREE.Plane(UP.clone(), -target.y), new THREE.Vector3());
  if (!hit) return null;
  const d = camera.position.distanceTo(target);
  return hit.distanceTo(camera.position) > d * 4 ? null : hit;
}

/** WebKit's gesture rotation (degrees, clockwise) as an orbit turn that rotates the map with the fingers. */
export function twistToAzimuth(deg: number): number {
  return (deg * Math.PI) / 180;
}

// ---------------------------------------------------------------------------------------------
// Building interiors. Inside a building there's nothing to scroll across, so the gestures swap:
// two fingers look around the room through a full circle, and Option with a scroll walks the view
// across the floor. Pinch and twist work as on the map, and a mouse wheel still zooms.

export type InteriorIntent =
  | { kind: "pass" }
  | { kind: "drop" }
  | { kind: "look"; azimuth: number; polar: number }
  | { kind: "move"; dx: number; dy: number }
  | { kind: "zoom"; factor: number };

/**
 * What a wheel event should do inside a building. Same device detection and settings as the
 * map: "zoom" mode leaves every plain scroll to the controls, "pan" treats every scroll as a
 * trackpad's. The look direction matches dragging the room: fingers left turn the room left
 * with them, fingers up (natural scrolling) bring the view down toward eye level.
 */
export function interiorIntent(e: WheelSample, c: WheelClassifier, mode: ScrollMode, speed: number, gesturing: boolean, pageH = 800): InteriorIntent {
  const { kind, stale } = c.classify(e);
  const { dx, dy } = pixels(e, pageH);
  if (e.ctrlKey) {
    if (gesturing) return { kind: "drop" };
    if (kind === "trackpad") c.sawPinch();
    const f = Math.exp(-dy * TUNING.pinch * speed);
    return { kind: "zoom", factor: THREE.MathUtils.clamp(f, 1 / TUNING.maxStep, TUNING.maxStep) };
  }
  if (stale) return { kind: "drop" };
  if (e.altKey) return { kind: "move", dx: dx * TUNING.pan * speed, dy: dy * TUNING.pan * speed };
  const look = mode === "pan" || (mode === "auto" && kind === "trackpad");
  if (!look) return { kind: "pass" };
  return { kind: "look", azimuth: dx * TUNING.orbit * speed, polar: dy * TUNING.tilt * speed };
}

/** Keep the point looked at inside a room of half-size `reach` around the origin, camera with it. */
export function clampToRoom(rig: Rig, reach: { x: number; z: number }) {
  const x = THREE.MathUtils.clamp(rig.target.x, -reach.x, reach.x);
  const z = THREE.MathUtils.clamp(rig.target.z, -reach.z, reach.z);
  const fix = new THREE.Vector3(x - rig.target.x, 0, z - rig.target.z);
  rig.target.add(fix);
  rig.position.add(fix);
}

/**
 * Which quarter around the building the camera is in, as the signs of its x and z (0 counts as
 * positive). Interiors are drawn around the origin, so this says which walls and neighbours
 * stand between the camera and the room.
 */
export function quarterOf(p: { x: number; z: number }): { x: 1 | -1; z: 1 | -1 } {
  return { x: p.x < 0 ? -1 : 1, z: p.z < 0 ? -1 : 1 };
}
