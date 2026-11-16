import { useSyncExternalStore } from "react";
import type { Catalog } from "../catalog/types";
import { IntelligenceStore, localIntelBackend } from "./memory";
import type { IntelligenceFile } from "./types";

// The app's intelligence store: one per window, on this device's storage like the Task Center.
// Expired working memory is swept once per app start (retention).

let shared: IntelligenceStore | null = null;

export function intelStore(catalog: Catalog): IntelligenceStore {
  if (!shared) {
    shared = new IntelligenceStore(localIntelBackend, catalog);
    shared.sweep();
  } else shared.setCatalog(catalog);
  return shared;
}

export function useIntel(catalog: Catalog): { store: IntelligenceStore; file: IntelligenceFile } {
  const store = intelStore(catalog);
  const file = useSyncExternalStore(
    (fn) => store.subscribe(fn),
    () => store.snapshot(),
    () => store.snapshot(),
  );
  return { store, file };
}
