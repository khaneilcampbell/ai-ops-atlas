import { useSyncExternalStore } from "react";
import { load, save } from "./storage";

/**
 * How the 3D map reads a two-finger scroll, and how fast trackpad gestures move it.
 *
 * The stored values stay auto, pan and zoom; the labels name the Mac each suits.
 *
 * - auto (default): a trackpad scroll moves the map and a mouse wheel zooms. Atlas tells the two
 *   apart from the events themselves, which is reliable in most cases but not all (see trackpad.ts).
 * - pan: every plain scroll moves the map, the way a trackpad does in Apple Maps.
 * - zoom: every plain scroll zooms, the old behavior, for a mouse wheel that Automatic misreads.
 *
 * Pinch and Command with a scroll always zoom, and Option with a scroll always turns and tilts the
 * view. The keyboard works the same in every mode (see map3d/keys.ts).
 */
export type ScrollMode = "auto" | "pan" | "zoom";
export type TrackpadSpeed = "slow" | "normal" | "fast";

export const SCROLL_MODES: { mode: ScrollMode; label: string; hint: string }[] = [
  { mode: "auto", label: "Automatic", hint: "A trackpad or Magic Mouse scroll moves the map and a mouse wheel zooms. Pinch, or Command with a scroll, zooms. Twist, or Option with a scroll, turns and tilts." },
  { mode: "pan", label: "Trackpad (MacBook)", hint: "Every two-finger scroll moves the map. Pinch to zoom, twist to turn, hold Option and scroll to turn and tilt." },
  { mode: "zoom", label: "Mouse wheel (iMac)", hint: "Every scroll zooms, for an iMac or any mouse with a wheel. Drag to move the map, right-drag to turn and tilt, or hold Option and scroll." },
];

export const TRACKPAD_SPEEDS: { speed: TrackpadSpeed; label: string; factor: number }[] = [
  { speed: "slow", label: "Slower", factor: 0.6 },
  { speed: "normal", label: "Normal", factor: 1 },
  { speed: "fast", label: "Faster", factor: 1.6 },
];

export interface NavigationPrefs {
  scroll: ScrollMode;
  speed: TrackpadSpeed;
}

const valid = (p: Partial<NavigationPrefs>): NavigationPrefs => ({
  scroll: SCROLL_MODES.some((m) => m.mode === p.scroll) ? p.scroll! : "auto",
  speed: TRACKPAD_SPEEDS.some((s) => s.speed === p.speed) ? p.speed! : "normal",
});

let prefs: NavigationPrefs = valid(load<Partial<NavigationPrefs>>("mapNavigation", {}));
const listeners = new Set<() => void>();
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => void listeners.delete(l);
};

export function setNavigationPrefs(next: Partial<NavigationPrefs>) {
  prefs = valid({ ...prefs, ...next });
  save("mapNavigation", prefs);
  listeners.forEach((l) => l());
}

export function getNavigationPrefs(): NavigationPrefs {
  return prefs;
}

export function useNavigationPrefs(): NavigationPrefs {
  return useSyncExternalStore(subscribe, () => prefs);
}

export function speedFactor(s: TrackpadSpeed): number {
  return TRACKPAD_SPEEDS.find((x) => x.speed === s)?.factor ?? 1;
}
