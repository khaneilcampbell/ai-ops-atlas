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

// Caches Atlas can always fetch again. When local storage is full (about 5 MB in the Mac app),
// these are dropped first so tasks, workflow runs and settings can still be saved.
export const DISPOSABLE_KEYS = ["atlas:etags", "atlas:repoCache"] as const;

/** Removes the refetchable caches. Returns how many characters that freed. */
export function freeDisposable(except?: string): number {
  let freed = 0;
  for (const k of DISPOSABLE_KEYS) {
    if (k === except) continue;
    try {
      freed += localStorage.getItem(k)?.length ?? 0;
      localStorage.removeItem(k);
    } catch {
      /* ignore */
    }
  }
  return freed;
}

/**
 * Writes a raw value; if storage is full, drops the refetchable caches and tries once more.
 * Throws if it still can't be saved, so callers can tell the person.
 */
export function writeWithRoom(fullKey: string, raw: string) {
  try {
    localStorage.setItem(fullKey, raw);
  } catch (first) {
    if (!freeDisposable(fullKey)) throw first;
    localStorage.setItem(fullKey, raw);
  }
}

export function save(key: string, value: unknown) {
  try {
    writeWithRoom(`atlas:${key}`, JSON.stringify(value));
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
