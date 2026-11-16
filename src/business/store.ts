import { useSyncExternalStore } from "react";
import type { Backend } from "../tasks/store";
import { EMPTY_DATA, type BusinessData, type Collection } from "./types";

// Where business records are kept: this device's local storage, like the Task Center, behind the
// same Backend interface so a server store can replace it later. Personal details (leads,
// customers) therefore never leave the device and never reach the public repository. Every write
// reads the stored copy again first and is compare-and-set on the record's `rev`, so two windows
// can't overwrite each other.

const KEY = "atlas:business";
const VERSION = 1;

export const localBusinessBackend: Backend = {
  read: () => {
    try {
      return localStorage.getItem(KEY);
    } catch {
      return null;
    }
  },
  write: (raw) => localStorage.setItem(KEY, raw),
  watch: (fn) => {
    const on = (e: StorageEvent) => e.key === KEY && fn();
    window.addEventListener("storage", on);
    return () => window.removeEventListener("storage", on);
  },
};

type Row = { id: string; rev: number };
export type StoreResult = { ok: true } | { ok: false; error: string };

const COLLECTIONS = Object.keys(EMPTY_DATA) as Collection[];

export function parseBusiness(raw: string | null): BusinessData {
  if (!raw) return { ...EMPTY_DATA };
  try {
    const f = JSON.parse(raw) as { version?: number } & Partial<Record<Collection, unknown>>;
    if (f.version !== VERSION) return { ...EMPTY_DATA };
    const out = { ...EMPTY_DATA } as Record<Collection, Row[]>;
    for (const c of COLLECTIONS) {
      const list = f[c];
      out[c] = Array.isArray(list) ? list.filter((r): r is Row => !!r && typeof (r as Row).id === "string" && typeof (r as Row).rev === "number" && ((r as { provenance?: string }).provenance === "real" || (r as { provenance?: string }).provenance === "test")) : [];
    }
    return out as unknown as BusinessData;
  } catch {
    return { ...EMPTY_DATA };
  }
}

export class BusinessStore {
  readonly scope = "device" as const;
  private data: BusinessData;
  private listeners = new Set<() => void>();
  constructor(private backend: Backend) {
    this.data = parseBusiness(backend.read());
    backend.watch?.(() => {
      this.data = parseBusiness(backend.read());
      this.emit();
    });
  }

  snapshot(): BusinessData {
    return this.data;
  }

  private commit(next: BusinessData): StoreResult {
    try {
      this.backend.write(JSON.stringify({ version: VERSION, ...next }));
    } catch {
      return { ok: false, error: "This device's storage is full or blocked, so nothing was saved." };
    }
    this.data = next;
    this.emit();
    return { ok: true };
  }

  create<C extends Collection>(c: C, record: BusinessData[C][number]): StoreResult {
    const fresh = parseBusiness(this.backend.read());
    const list = fresh[c] as Row[];
    if (list.some((r) => r.id === (record as Row).id)) return { ok: false, error: "A record with this id already exists." };
    return this.commit({ ...fresh, [c]: [...list, { ...record, rev: 1 }] });
  }

  /** Saves only if the stored record is still at `expectedRev`. */
  put<C extends Collection>(c: C, record: BusinessData[C][number], expectedRev: number): StoreResult {
    const fresh = parseBusiness(this.backend.read());
    const list = fresh[c] as Row[];
    const i = list.findIndex((r) => r.id === (record as Row).id);
    if (i < 0) return { ok: false, error: "That record no longer exists." };
    if (list[i].rev !== expectedRev) return { ok: false, error: "Someone changed this record in another window. Reload and try again." };
    const next = [...list];
    next[i] = { ...record, rev: expectedRev + 1 };
    return this.commit({ ...fresh, [c]: next });
  }

  remove(c: Collection, id: string): StoreResult {
    const fresh = parseBusiness(this.backend.read());
    return this.commit({ ...fresh, [c]: (fresh[c] as Row[]).filter((r) => r.id !== id) });
  }

  /** Removes every test record and nothing else. */
  clearTestData(): StoreResult {
    const fresh = parseBusiness(this.backend.read());
    const next = { ...fresh } as Record<Collection, { provenance: string }[]>;
    for (const c of COLLECTIONS) next[c] = (fresh[c] as { provenance: string }[]).filter((r) => r.provenance !== "test");
    return this.commit(next as unknown as BusinessData);
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private emit() {
    for (const fn of this.listeners) fn();
  }
}

let shared: BusinessStore | null = null;
export function businessStore(): BusinessStore {
  return (shared ??= new BusinessStore(localBusinessBackend));
}

export function useBusiness(): BusinessData {
  const s = businessStore();
  return useSyncExternalStore((fn) => s.subscribe(fn), () => s.snapshot());
}
