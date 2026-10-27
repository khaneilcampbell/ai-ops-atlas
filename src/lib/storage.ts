// Local, non-secret persistence (preferences and cached GitHub metadata).
// Never store tokens here: those live in the macOS Keychain via the Rust side.
export function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(`atlas:${key}`);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function save(key: string, value: unknown) {
  try {
    localStorage.setItem(`atlas:${key}`, JSON.stringify(value));
  } catch {
    /* storage full or unavailable: the app still works without the cache */
  }
}

export function remove(key: string) {
  try {
    localStorage.removeItem(`atlas:${key}`);
  } catch {
    /* ignore */
  }
}
