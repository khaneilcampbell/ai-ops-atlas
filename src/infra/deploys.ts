import { useEffect, useMemo, useSyncExternalStore } from "react";
import { fetchDeploys, type Deploy } from "../properties/deploys";
import { useAllPropertyData, useShas, type Loaded } from "../properties/state";
import { ATLAS_REPOSITORY, HOSTS, type HostTarget } from "./hosts";

// Deploys for the hosts no website dashboard polls (Atlas web and the Mac app), read from the
// check runs on Atlas's newest main commits with the same read-only GitHub access the rest of
// Atlas uses. Polled every 5 minutes while the window is visible and the list is on screen.

const EVERY_MS = 5 * 60_000;
const OWN = HOSTS.filter((h) => !h.propertyId);

const empty = (): Loaded<Deploy[]> => ({ state: "loading", message: null, value: null, at: null });
let data: Record<string, Loaded<Deploy[]>> = Object.fromEntries(OWN.map((h) => [h.id, empty()]));
const watchers = new Set<() => void>();
const subscribe = (w: () => void) => {
  watchers.add(w);
  return () => watchers.delete(w);
};
const set = (id: string, v: Loaded<Deploy[]>) => {
  data = { ...data, [id]: v };
  watchers.forEach((w) => w());
};

export async function refreshHost(h: HostTarget, shas: string[]) {
  const prev = data[h.id] ?? empty();
  if (!shas.length) return;
  try {
    set(h.id, { state: "ready", message: null, value: await fetchDeploys(h, shas), at: new Date().toISOString() });
  } catch (e) {
    set(h.id, { ...prev, state: "error", message: e instanceof Error ? e.message : String(e) });
  }
}

const visible = () => typeof document === "undefined" || document.visibilityState === "visible";

/** Every host's deploys, keyed by host id. Websites reuse their dashboard's poller. */
export function useHostDeploys(): Map<string, Loaded<Deploy[]>> {
  const shas = useShas(ATLAS_REPOSITORY);
  useEffect(() => {
    const run = () => OWN.forEach((h) => void refreshHost(h, shas));
    run();
    const t = setInterval(() => visible() && run(), EVERY_MS);
    return () => clearInterval(t);
  }, [shas]);
  const own = useSyncExternalStore(subscribe, () => data, () => data);
  const sites = useAllPropertyData();
  return useMemo(
    () => new Map(HOSTS.map((h) => [h.id, (h.propertyId ? sites[h.propertyId]?.deploys : own[h.id]) ?? empty()] as const)),
    [sites, own],
  );
}
