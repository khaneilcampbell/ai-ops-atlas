/**
 * Keyboard navigation for the 3D map and building interiors, for a Mac with a mouse and keyboard
 * (an iMac) as much as a MacBook. Plain functions so the key map and the movement are tested
 * without a browser.
 *
 * Held keys move smoothly for as long as they are down, at a rate per second rather than per key
 * repeat, so the speed is the same on every Mac whatever its key repeat setting.
 *
 * On the map (the map must have focus: click it once):
 * - W A S D, or Shift with the arrow keys: move the map. Plain arrow keys still step between
 *   projects, as before.
 * - R and F: tilt toward looking straight down, and toward the horizon.
 * - Q and E (unchanged, handled by the map view): turn 45 degrees. Plus, minus and 0 zoom and fit.
 *
 * Inside a building:
 * - W A S D or the arrow keys: walk the view across the floor.
 * - Q and E: turn left and right. R and F: tilt.
 * - Plus and minus: zoom. 0: back to the view the room opened with.
 *
 * Keys pressed with Command or Control are never taken, so Mac shortcuts (Command W, Command K,
 * Command 1) keep working.
 */

export type NavKey = "left" | "right" | "forward" | "back" | "turnLeft" | "turnRight" | "tiltDown" | "tiltUp" | "zoomIn" | "zoomOut";

export type NavContext = "map" | "interior";

/** The parts of a KeyboardEvent this module reads. */
export interface KeySample {
  key: string;
  code: string;
  shiftKey: boolean;
  altKey: boolean;
  metaKey: boolean;
  ctrlKey: boolean;
}

/** Movement rates per second at the Normal speed setting. */
export const KEY_RATES = {
  /** Screen pixels of ground per second: about a third of a laptop screen. */
  pan: 520,
  /** Radians turned per second. */
  turn: 1.4,
  /** Radians tilted per second. */
  tilt: 0.9,
  /** Zoom factor per second. */
  zoom: 2.2,
  /** A frame longer than this (a background tab, a dropped frame) moves no further than this. */
  maxFrameMs: 64,
} as const;

// Letters by physical position (KeyboardEvent.code), so they sit in the same place on any layout.
const LETTERS: Record<string, NavKey> = { KeyW: "forward", KeyA: "left", KeyS: "back", KeyD: "right", KeyR: "tiltDown", KeyF: "tiltUp" };
const INTERIOR_LETTERS: Record<string, NavKey> = { ...LETTERS, KeyQ: "turnLeft", KeyE: "turnRight" };
const ARROWS: Record<string, NavKey> = { ArrowUp: "forward", ArrowDown: "back", ArrowLeft: "left", ArrowRight: "right" };

/**
 * The held movement a key stands for, or null to leave the key to the rest of the app.
 * On the map, plain arrows stay with the map view (they step between projects); Shift with an
 * arrow moves the map. Zoom by key is held movement only inside a building: on the map plus and
 * minus already step the zoom.
 */
export function navKeyOf(e: KeySample, ctx: NavContext): NavKey | null {
  if (e.metaKey || e.ctrlKey || e.altKey) return null;
  const letters = ctx === "interior" ? INTERIOR_LETTERS : LETTERS;
  if (letters[e.code]) return letters[e.code];
  if (ARROWS[e.key] && (ctx === "interior" || e.shiftKey)) return ARROWS[e.key];
  if (ctx === "interior") {
    if (e.key === "+" || e.key === "=") return "zoomIn";
    if (e.key === "-" || e.key === "_") return "zoomOut";
  }
  return null;
}

/** What the keys held for `dtMs` milliseconds do: a pan in pixels, a turn and tilt in radians, a zoom factor. */
export interface KeyStep {
  dx: number;
  dy: number;
  azimuth: number;
  polar: number;
  zoom: number;
}

/**
 * The movement for one frame. Signs match the trackpad functions in trackpad.ts: dx > 0 moves
 * the view right, dy < 0 moves it forward, azimuth > 0 turns the same way as Q on the map, and
 * polar > 0 tilts toward the horizon. Opposite keys cancel.
 */
export function keyStep(held: ReadonlySet<NavKey>, dtMs: number, speed = 1): KeyStep {
  const t = (Math.min(Math.max(dtMs, 0), KEY_RATES.maxFrameMs) / 1000) * speed;
  const axis = (pos: NavKey, neg: NavKey) => (held.has(pos) ? 1 : 0) - (held.has(neg) ? 1 : 0);
  let x = axis("right", "left");
  let y = axis("back", "forward");
  // Diagonals go no faster than straight lines.
  if (x && y) {
    x *= Math.SQRT1_2;
    y *= Math.SQRT1_2;
  }
  return {
    dx: x * KEY_RATES.pan * t,
    dy: y * KEY_RATES.pan * t,
    azimuth: axis("turnLeft", "turnRight") * KEY_RATES.turn * t,
    polar: axis("tiltUp", "tiltDown") * KEY_RATES.tilt * t,
    zoom: Math.pow(KEY_RATES.zoom, axis("zoomIn", "zoomOut") * t),
  };
}

/** True when the step moves nothing. */
export function isStill(s: KeyStep): boolean {
  return s.dx === 0 && s.dy === 0 && s.azimuth === 0 && s.polar === 0 && s.zoom === 1;
}

/** A key event aimed at something that takes typing or arrow keys of its own. */
export function typingTarget(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el || typeof el.closest !== "function") return false;
  return !!el.closest("input, textarea, select, [contenteditable=''], [contenteditable='true'], [role='tablist'], [role='listbox'], [role='menu'], [role='slider']");
}

/**
 * Tracks held navigation keys and runs `apply` once a frame while any are down, with the time
 * since the last frame. Releases everything when the window loses focus, so a key let go in
 * another app doesn't keep the view moving.
 */
export class HeldKeys {
  private held = new Set<NavKey>();
  private frame = 0;
  private last = 0;
  constructor(
    private apply: (held: ReadonlySet<NavKey>, dtMs: number) => void,
    private raf: (cb: (t: number) => void) => number = (cb) => requestAnimationFrame(cb),
    private caf: (id: number) => void = (id) => cancelAnimationFrame(id),
  ) {}

  get size() {
    return this.held.size;
  }

  press(k: NavKey, now: number) {
    if (this.held.has(k)) return;
    this.held.add(k);
    if (!this.frame) {
      this.last = now;
      // A tap shorter than a frame still nudges the view.
      this.apply(this.held, 16);
      this.frame = this.raf(this.tick);
    }
  }

  release(k: NavKey) {
    this.held.delete(k);
    if (!this.held.size) this.stop();
  }

  releaseAll() {
    this.held.clear();
    this.stop();
  }

  private stop() {
    if (this.frame) this.caf(this.frame);
    this.frame = 0;
  }

  private tick = (now: number) => {
    if (!this.held.size) return void (this.frame = 0);
    const dt = now - this.last;
    this.last = now;
    this.apply(this.held, dt);
    this.frame = this.raf(this.tick);
  };
}

/** Every control, for the Controls help panel and Settings: what a MacBook and an iMac each do. */
export interface ControlRow {
  action: string;
  trackpad: string;
  mouse: string;
}

export const MAP_CONTROLS: ControlRow[] = [
  { action: "Move the map", trackpad: "Two-finger scroll, or drag", mouse: "Drag, W A S D, or Shift with the arrow keys" },
  { action: "Zoom", trackpad: "Pinch", mouse: "Scroll wheel, Command with a scroll (Magic Mouse), or + and −" },
  { action: "Turn", trackpad: "Twist two fingers, or Option with a scroll", mouse: "Right-drag, Control or Shift with a drag, Option with a scroll, or Q and E" },
  { action: "Tilt", trackpad: "Option with a scroll up or down", mouse: "Right-drag up or down, Option with a scroll, or R and F" },
  { action: "Fit the whole map", trackpad: "0, or the Fit button", mouse: "0, or the Fit button" },
  { action: "Select a building", trackpad: "Click, or arrow keys and Return", mouse: "Click, or arrow keys and Return" },
  { action: "See inside", trackpad: "I", mouse: "I" },
];

export const INTERIOR_CONTROLS: ControlRow[] = [
  { action: "Look around", trackpad: "Two-finger scroll", mouse: "Drag, Q and E to turn, R and F to tilt" },
  { action: "Move across the floor", trackpad: "Option with a scroll", mouse: "W A S D or the arrow keys (right-drag too, in most buildings)" },
  { action: "Zoom", trackpad: "Pinch", mouse: "Scroll wheel, Command with a scroll (Magic Mouse), or + and −" },
  { action: "Back to the starting view", trackpad: "0", mouse: "0" },
  { action: "Leave the building", trackpad: "Esc", mouse: "Esc" },
];
