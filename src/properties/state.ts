import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { notify } from "../alerts/notify";
import { useNotifyOn } from "../alerts/state";
import { isHostedWeb, isTauri } from "../lib/env";
import { onLiveEvents } from "../live/feed";
import { load, save } from "../lib/storage";
import { useAtlas } from "../state";
import { fetchDeploys, type Deploy } from "./deploys";
import { incidentsFor, type Incident } from "./incidents";
import { PROPERTIES, type WebProperty } from "./registry";
import type { SiteSnapshot } from "./types";

// One shared store for the website dashboards, so the header pill and an open building panel
// read the same answers. Site checks come from the site (cached there); deploys from GitHub.
// Polling runs only while the window is visible: site checks every 15 minutes, deploys every 5
// and soon after the live feed reports a push or workflow run in the site's repository.

export interface Loaded<T> {
  state: "off" | "loading" | "ready" | "error";
  message: string | null;
  value: T | null;
  at: string | null;
}

export interface PropertyData {
  site: Loaded<SiteSnapshot>;
  deploys: Loaded<Deploy[]>;
}

const SITE_EVERY_MS = 15 * 60_000;
const DEPLOYS_EVERY_MS = 5 * 60_000;
/** Workers Builds starts its check run a little after the push lands. */
const AFTER_PUSH_MS = 45_000;
const DISMISSED_KEY = "propertyIncidentsDismissed";
const NOTIFIED_KEY = "propertyIncidentsNotified";
const KEEP = 200;
const NOTIFY_WITHIN_MS = 24 * 3_600_000;

const empty = <T,>(): Loaded<T> => ({ state: "loading", message: null, value: null, at: null });
let data: Record<string, PropertyData> = Object.fromEntries(PROPERTIES.map((p) => [p.id, { site: empty<SiteSnapshot>(), deploys: empty<Deploy[]>() }]));
let dismissed = new Set(load<string[]>(DISMISSED_KEY, []));
const watchers = new Set<() => void>();
const emit = () => watchers.forEach((w) => w());
const subscribe = (w: () => void) => {
  watchers.add(w);
  return () => watchers.delete(w);
};

function set(id: string, part: keyof PropertyData, value: PropertyData[keyof PropertyData]) {
  data = { ...data, [id]: { ...data[id], [part]: value } };
  emit();
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

async function fetchSite(p: WebProperty): Promise<SiteSnapshot | null> {
  const q = `domain=${encodeURIComponent(p.domain)}`;
  if (isHostedWeb()) {
    const r = await fetch(`/api/properties?${q}`, { credentials: "same-origin", cache: "no-store" });
    if (!r.ok) throw new Error(((await r.json().catch(() => null)) as { message?: string } | null)?.message ?? `The site answered ${r.status}.`);
    return (await r.json()) as SiteSnapshot;
  }
  if (isTauri()) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<SiteSnapshot | null>("live_properties", { domain: p.domain });
  }
  return null;
}

export async function refreshSite(p: WebProperty) {
  const prev = data[p.id].site;
  set(p.id, "site", { ...prev, state: prev.value ? prev.state : "loading" });
  try {
    const s = await fetchSite(p);
    set(p.id, "site", s ? { state: "ready", message: null, value: s, at: new Date().toISOString() } : { state: "off", message: isTauri() ? "Site checks need website sync on this Mac (Settings → Website sync)." : "Site checks run on the hosted site and in the Mac app.", value: null, at: null });
  } catch (e) {
    set(p.id, "site", { ...prev, state: "error", message: message(e) });
  }
}

export async function refreshDeploys(p: WebProperty, shas: string[]) {
  const prev = data[p.id].deploys;
  if (p.deploy.kind === "check-runs" && !shas.length) {
    set(p.id, "deploys", { ...prev, state: prev.value ? prev.state : "loading" });
    return;
  }
  try {
    const list = await fetchDeploys(p, shas);
    set(p.id, "deploys", { state: "ready", message: null, value: list, at: new Date().toISOString() });
  } catch (e) {
    set(p.id, "deploys", { ...prev, state: "error", message: message(e) });
  }
}

export function dismissIncidents(keys: string[]) {
  dismissed = new Set([...dismissed, ...keys].slice(-KEEP));
  save(DISMISSED_KEY, [...dismissed]);
  emit();
}

const visible = () => typeof document === "undefined" || document.visibilityState === "visible";

/** The newest default-branch commits of a repository, from the snapshot Atlas already has. */
export function useShas(repository: string): string[] {
  const { repos } = useAtlas();
  const r = repos[repository];
  const snap = r?.kind === "ok" ? r.data : r?.kind === "error" ? r.data : undefined;
  const key = (snap?.commits ?? []).slice(0, 3).map((c) => c.sha).join(",");
  return useMemo(() => (key ? key.split(",") : []), [key]);
}

function usePoller(p: WebProperty) {
  const shas = useShas(p.repository);
  useEffect(() => {
    void refreshSite(p);
    const t = setInterval(() => visible() && void refreshSite(p), SITE_EVERY_MS);
    return () => clearInterval(t);
  }, [p]);
  useEffect(() => {
    void refreshDeploys(p, shas);
    const t = setInterval(() => visible() && void refreshDeploys(p, shas), DEPLOYS_EVERY_MS);
    let soon: ReturnType<typeof setTimeout> | undefined;
    const off = onLiveEvents((events) => {
      if (!events.some((e) => e.repo?.toLowerCase() === p.repository.toLowerCase())) return;
      clearTimeout(soon);
      soon = setTimeout(() => void refreshDeploys(p, shas), AFTER_PUSH_MS);
    });
    return () => {
      clearInterval(t);
      clearTimeout(soon);
      off();
    };
  }, [p, shas]);
}

/** Starts the pollers. Mount once, at the app root. */
export function usePropertyPolling() {
  usePoller(PROPERTIES[0]);
  usePoller(PROPERTIES[1]);
}

/** Every website's data, keyed by property id. */
export function useAllPropertyData(): Readonly<Record<string, PropertyData>> {
  return useSyncExternalStore(subscribe, () => data);
}

export function usePropertyData(id: string): PropertyData | null {
  return useSyncExternalStore(subscribe, () => data)[id] ?? null;
}

/** Every open incident on every website, re-judged each minute. */
export function usePropertyIncidents(): { all: Incident[]; open: Incident[] } {
  const all = useSyncExternalStore(subscribe, () => data);
  const seen = useSyncExternalStore(subscribe, () => dismissed);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);
  return useMemo(() => {
    const list = PROPERTIES.flatMap((p) => incidentsFor(p, all[p.id]?.site.value ?? null, all[p.id]?.deploys.value ?? null, now));
    return { all: list, open: list.filter((i) => !seen.has(i.key)) };
  }, [all, seen, now]);
}

/** One system notification per new critical incident, when KC has notifications on. Mount once. */
export function usePropertyNotifications(open: Incident[]) {
  const on = useNotifyOn();
  useEffect(() => {
    if (!on) return;
    const notified = new Set(load<string[]>(NOTIFIED_KEY, []));
    const now = Date.now();
    const fresh = open.filter((i) => i.severity === "critical" && !notified.has(i.key) && now - Date.parse(i.since) <= NOTIFY_WITHIN_MS);
    if (!fresh.length) return;
    save(NOTIFIED_KEY, [...notified, ...fresh.map((i) => i.key)].slice(-KEEP));
    for (const i of fresh) void notify(`${PROPERTIES.find((p) => p.id === i.propertyId)?.domain}: ${i.title}`, i.detail).catch(() => undefined);
  }, [on, open]);
}
