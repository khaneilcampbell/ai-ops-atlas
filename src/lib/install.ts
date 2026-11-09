/**
 * Whether to suggest adding Atlas to the iPhone Home Screen: a phone browser that isn't
 * already running Atlas as a Home Screen app, and the hint not dismissed before.
 */
export function shouldSuggestInstall(env: { tauri: boolean; phone: boolean; standalone: boolean; dismissed: boolean }): boolean {
  return !env.tauri && env.phone && !env.standalone && !env.dismissed;
}

/** True when Atlas was opened from the Home Screen (full screen, no Safari bar). */
export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  const nav = window.navigator as Navigator & { standalone?: boolean };
  return nav.standalone === true || window.matchMedia("(display-mode: standalone)").matches;
}
