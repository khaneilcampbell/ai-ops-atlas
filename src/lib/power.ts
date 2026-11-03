import { useEffect, useSyncExternalStore } from "react";
import { isTauri } from "./env";
import { load, save } from "./storage";

/**
 * How hard the 3D scenes work, which is most of what the app costs in battery.
 *
 * - balanced (default): looks the same as full. Draws at the display's rate while you move the
 *   camera or something transitions, and at 30 frames a second while only the quiet background
 *   life moves (boats, people, cars, water). Shadows follow moving things 20 times a second.
 * - full: every frame at the display's rate, as before.
 * - saver: a visible trade for battery. 15 frames a second at rest, sharp but not full Retina
 *   pixels, smaller shadows, and the background life holds still while the window isn't in front.
 * - auto: balanced on power, saver on battery.
 */
export type PowerMode = "balanced" | "full" | "saver" | "auto";

export interface PowerProfile {
  /** Frames a second while nothing is being moved or transitioning; Infinity is every display frame. */
  idleFps: number;
  /** Shadow map redraws a second; the sun is fixed, so only moving things need them. */
  shadowHz: number;
  /** Highest device pixel ratio the canvas draws at. */
  maxDpr: number;
  shadowMap: number;
  /** Stop the background life while the window isn't focused. */
  pauseInBackground: boolean;
}

const PROFILES: Record<Exclude<PowerMode, "auto">, PowerProfile> = {
  full: { idleFps: Infinity, shadowHz: Infinity, maxDpr: 2, shadowMap: 4096, pauseInBackground: false },
  balanced: { idleFps: 30, shadowHz: 20, maxDpr: 2, shadowMap: 4096, pauseInBackground: false },
  saver: { idleFps: 15, shadowHz: 8, maxDpr: 1.5, shadowMap: 2048, pauseInBackground: true },
};

export const POWER_MODES: { mode: PowerMode; label: string; hint: string }[] = [
  { mode: "balanced", label: "Balanced", hint: "Looks the same as Best. Draws fewer frames while only the background life moves." },
  { mode: "auto", label: "Automatic", hint: "Balanced on power, Battery saver on battery." },
  { mode: "saver", label: "Battery saver", hint: "Slower background animation, slightly softer image, and the map holds still while Atlas isn't the front window." },
  { mode: "full", label: "Best", hint: "Every frame at the display's rate, all the time. Uses the most battery." },
];

let mode: PowerMode = load<PowerMode>("powerMode", "balanced");
if (!POWER_MODES.some((m) => m.mode === mode)) mode = "balanced";
let onBattery: boolean | null = null;
let focused = typeof document === "undefined" || document.hasFocus();
let visible = typeof document === "undefined" || document.visibilityState !== "hidden";
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => void listeners.delete(l);
};

export function setPowerMode(m: PowerMode) {
  mode = m;
  save("powerMode", m);
  emit();
}

export function usePowerMode(): PowerMode {
  return useSyncExternalStore(subscribe, () => mode);
}

/** True or false once known; null in a browser that can't tell (Safari) or on a desktop Mac. */
export function useOnBattery(): boolean | null {
  return useSyncExternalStore(subscribe, () => onBattery);
}

export function profileFor(m: PowerMode, battery: boolean | null): PowerProfile {
  return PROFILES[m === "auto" ? (battery ? "saver" : "balanced") : m];
}

/** The profile in effect now, following the setting and, for Automatic, the power source. */
export function usePowerProfile(): PowerProfile {
  const m = usePowerMode();
  const battery = useOnBattery();
  useBatteryWatch(m === "auto");
  return profileFor(m, battery);
}

/** Shared by the map and interiors: hidden windows must not keep a frame pump alive. */
export function usePageVisible(): boolean {
  return useSyncExternalStore(subscribe, () => visible);
}

/** Static scenes still accept camera redraws; hidden/covered canvases do no scheduled work. */
export function pacingPolicy(profile: PowerProfile, running: boolean, focused: boolean, visible: boolean, frameloop: string) {
  return {
    active: visible && frameloop !== "never",
    idle: !running || (profile.pauseInBackground && !focused) ? 0 : profile.idleFps,
  };
}

/** Whether the window is the one in front. */
export function useWindowFocused(): boolean {
  return useSyncExternalStore(subscribe, () => focused);
}

if (typeof window !== "undefined") {
  const set = (f: boolean) => {
    if (f === focused) return;
    focused = f;
    emit();
  };
  document.addEventListener("visibilitychange", () => {
    const next = document.visibilityState !== "hidden";
    if (next !== visible) { visible = next; emit(); }
  });
  window.addEventListener("focus", () => set(true));
  window.addEventListener("blur", () => set(false));
}

// While anything is being moved or eased, scenes draw every display frame until this time.
let busyUntil = 0;
const kicks = new Set<() => void>();
/** Ask for full frame rate for a little while: a camera move, a fade, a transition. */
export function wake(ms = 400) {
  const t = performance.now() + ms;
  if (t <= busyUntil) return;
  busyUntil = t;
  kicks.forEach((k) => k());
}
/** Called whenever wake() starts or extends a busy spell. */
export function onWake(k: () => void): () => void {
  kicks.add(k);
  return () => void kicks.delete(k);
}
export function isBusy(now = performance.now()): boolean {
  return now < busyUntil;
}

let watchers = 0;
let stopWatch: (() => void) | null = null;
const BATTERY_CHECK_MS = 2 * 60_000;

/** Follows the power source while some scene uses Automatic. */
function useBatteryWatch(on: boolean) {
  useEffect(() => {
    if (!on) return;
    if (watchers++ === 0) stopWatch = startBatteryWatch();
    return () => {
      if (--watchers === 0) {
        stopWatch?.();
        stopWatch = null;
      }
    };
  }, [on]);
}

function setBattery(b: boolean | null) {
  if (b === onBattery) return;
  onBattery = b;
  emit();
}

function startBatteryWatch(): () => void {
  let stopped = false;
  if (isTauri()) {
    const look = async () => {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const b = await invoke<boolean | null>("power_on_battery");
        if (!stopped) setBattery(b);
      } catch {
        // Older app build or no power information: stay on Balanced.
      }
    };
    void look();
    const t = setInterval(look, BATTERY_CHECK_MS);
    window.addEventListener("focus", look);
    return () => {
      stopped = true;
      clearInterval(t);
      window.removeEventListener("focus", look);
    };
  }
  // Chromium browsers report charging; Safari doesn't, so it stays on Balanced.
  const nav = navigator as Navigator & { getBattery?: () => Promise<EventTarget & { charging: boolean }> };
  if (!nav.getBattery) return () => undefined;
  let battery: (EventTarget & { charging: boolean }) | null = null;
  const on = () => battery && setBattery(!battery.charging);
  void nav.getBattery().then((b) => {
    if (stopped) return;
    battery = b;
    on();
    b.addEventListener("chargingchange", on);
  }, () => undefined);
  return () => {
    stopped = true;
    battery?.removeEventListener("chargingchange", on);
  };
}
