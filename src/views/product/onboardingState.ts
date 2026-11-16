import { useSyncExternalStore } from "react";
import { catalog } from "../../catalog";
import { KHANEIL } from "../../tasks/types";
import { INTEGRATION_CATALOG } from "../../product/integrations";
import { TEMPLATES } from "../../product/templates";
import { hasExistingData, PRODUCT_KEY, productStore } from "../../product/workspace";
import { load } from "../../lib/storage";
import { DEFAULT_TIME_ZONE } from "../../lib/timezone";

// Decides, once per launch, whether to show the first-run setup. The storage keys are read when
// this module loads, before the app writes anything, so an install that already has Atlas data is
// migrated into a workspace and never sees the wizard, while a fresh device does.

const keysAtLaunch: string[] = (() => {
  try {
    return Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i) ?? "").filter(Boolean);
  } catch {
    return [];
  }
})();

let open = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function openOnboarding() {
  open = true;
  emit();
}
export function closeOnboarding() {
  open = false;
  emit();
}
export function useOnboardingOpen(): boolean {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => open,
  );
}

let decided = false;
/** Runs once: migrates an existing install, or opens setup on a fresh one. */
export function decideFirstRun(now = new Date().toISOString()) {
  if (decided) return;
  decided = true;
  const store = productStore();
  const f = store.snapshot;
  if (f.workspaces.length || f.onboarding.status !== "not_started") {
    if (f.onboarding.status === "in_progress") openOnboarding();
    return;
  }
  if (hasExistingData(keysAtLaunch.filter((k) => k !== PRODUCT_KEY))) {
    store.migrate(
      {
        projects: catalog.projects.map((p) => p.id),
        agents: catalog.agents.filter((a) => a.status !== "retired").map((a) => a.id),
        integrations: INTEGRATION_CATALOG.map((i) => i.id),
        templates: TEMPLATES.filter((t) => t.definitionId).map((t) => t.id),
        timeZone: load<string>("timeZone", DEFAULT_TIME_ZONE),
      },
      KHANEIL,
      now,
    );
    return;
  }
  openOnboarding();
}
