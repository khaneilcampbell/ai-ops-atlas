import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useIntel } from "../intel/state";
import { useLiveStatus } from "../live/feed";
import { load, save } from "../lib/storage";
import { buildRegistry } from "../registry/registry";
import { useAtlas } from "../state";
import { ALERTING, openAlerts, watchAgents, type Watch } from "./alerts";
import { notify } from "./notify";

// Dismissed and already-notified alerts are remembered on this device, by alert key, so a
// dismissed failure stays quiet until the agent fails again or goes silent again.

const DISMISSED_KEY = "alertsDismissed";
const NOTIFIED_KEY = "alertsNotified";
const NOTIFY_KEY = "alertsNotify";
const KEEP = 200;
/** Only alerts newer than this pop a notification; older ones are history on a fresh device. */
const NOTIFY_WITHIN_MS = 24 * 3_600_000;
const TICK_MS = 60_000;

let dismissed = new Set(load<string[]>(DISMISSED_KEY, []));
let notifyOn = load<boolean>(NOTIFY_KEY, false);
const watchers = new Set<() => void>();
const emit = () => watchers.forEach((w) => w());
const subscribe = (w: () => void) => {
  watchers.add(w);
  return () => watchers.delete(w);
};

const keep = (keys: Iterable<string>) => [...keys].slice(-KEEP);

export function dismiss(keys: string[]) {
  dismissed = new Set(keep([...dismissed, ...keys]));
  save(DISMISSED_KEY, [...dismissed]);
  emit();
}

export function setNotifyOn(on: boolean) {
  notifyOn = on;
  save(NOTIFY_KEY, on);
  emit();
}

export function useNotifyOn(): boolean {
  return useSyncExternalStore(subscribe, () => notifyOn);
}

/** Every watched agent and the alerts still open. Re-checked each minute, so silence shows up
 *  without new data. */
export function useAlerts(): { watches: Watch[]; open: Watch[] } {
  const { catalog, repos } = useAtlas();
  const { telemetry } = useIntel();
  const feedLive = useLiveStatus().state === "live";
  const seen = useSyncExternalStore(subscribe, () => dismissed);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(t);
  }, []);
  const watched = useMemo(() => catalog.agents.filter((a) => a.alerts), [catalog]);
  const entries = useMemo(() => (watched.length ? buildRegistry({ projects: catalog.projects, agents: watched }, repos, telemetry) : []), [watched, catalog.projects, repos, telemetry]);
  const watches = useMemo(() => watchAgents(watched, entries, now, feedLive), [watched, entries, now, feedLive]);
  const open = useMemo(() => openAlerts(watches, seen), [watches, seen]);
  return { watches, open };
}

/** Pops one system notification per new alert while notifications are on. Mount once. */
export function useAlertNotifications(open: Watch[]) {
  const on = useNotifyOn();
  const send = useCallback(async (fresh: Watch[]) => {
    for (const w of fresh) {
      const what = w.state === "failing" ? "failed" : "has gone silent";
      await notify(`${w.agent.name} ${what}`, w.detail).catch(() => undefined);
    }
  }, []);
  useEffect(() => {
    if (!on) return;
    const notified = new Set(load<string[]>(NOTIFIED_KEY, []));
    const now = Date.now();
    const fresh = open.filter((w) => w.key && ALERTING.has(w.state) && !notified.has(w.key) && w.since && now - Date.parse(w.since) <= NOTIFY_WITHIN_MS);
    if (!fresh.length) return;
    save(NOTIFIED_KEY, keep([...notified, ...fresh.map((w) => w.key!)]));
    void send(fresh);
  }, [on, open, send]);
}
