import { useEffect, useSyncExternalStore } from "react";
import { isHostedWeb, isTauri } from "../lib/env";
import type { Run } from "../intel/types";
import { describe, upsertIntelRun, type LiveEvent } from "./apply";

// The live feed. GitHub webhooks and the Mac app's own agent runs are collected by the site
// (server/live.ts); this polls for anything newer than the last event seen, only while the
// window is visible, and hands new events to whoever listens. No GitHub requests are made here.

export interface LiveStatus {
  /** off: no site to ask (plain dev, or website sync not set up on the Mac). */
  state: "off" | "connecting" | "live" | "error";
  message: string | null;
  /** When the feed last answered. */
  checkedAt: string | null;
  /** The newest event that said something, for the header. */
  last: { at: string; text: string } | null;
  /** Repository Intelligence runs the Mac app reported, for the website. Null until the feed answers. */
  intelRuns: Run[] | null;
}

interface FeedPage {
  configured: boolean;
  cursor: number | null;
  events: LiveEvent[];
  /** More happened than one page holds; a normal refresh catches up. */
  gap?: boolean;
}

export const POLL_MS = 5_000;
const MAX_BACKOFF_MS = 60_000;

let status: LiveStatus = { state: "off", message: null, checkedAt: null, last: null, intelRuns: null };
const watchers = new Set<() => void>();
const listeners = new Set<(events: LiveEvent[], gap: boolean) => void>();

function set(patch: Partial<LiveStatus>) {
  status = { ...status, ...patch };
  watchers.forEach((w) => w());
}

/** Called with every batch of new events, oldest first. */
export function onLiveEvents(fn: (events: LiveEvent[], gap: boolean) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function useLiveStatus(): LiveStatus {
  return useSyncExternalStore(
    (w) => {
      watchers.add(w);
      return () => watchers.delete(w);
    },
    () => status,
  );
}

async function fetchPage(after: number | null): Promise<FeedPage | null> {
  if (isHostedWeb()) {
    const r = await fetch(`/api/events${after == null ? "" : `?after=${after}`}`, { credentials: "same-origin", cache: "no-store" });
    if (!r.ok) throw new Error(((await r.json().catch(() => null)) as { message?: string } | null)?.message ?? `The site answered ${r.status}.`);
    return (await r.json()) as FeedPage;
  }
  if (isTauri()) {
    const { invoke } = await import("@tauri-apps/api/core");
    // Null when website sync isn't set up: there is no site to ask.
    return invoke<FeedPage | null>("live_feed", { after });
  }
  return null;
}

let cursor: number | null = null;

async function poll(): Promise<number> {
  try {
    const page = await fetchPage(cursor);
    if (!page) {
      set({ state: "off", message: "Live updates need website sync (Settings → Website sync)." });
      return MAX_BACKOFF_MS;
    }
    if (!page.configured) {
      set({ state: "off", message: "Live updates aren't set up on the site yet." });
      return MAX_BACKOFF_MS;
    }
    cursor = page.cursor ?? cursor;
    let { last, intelRuns } = status;
    intelRuns ??= [];
    for (const e of page.events) {
      if (e.kind === "intel_run" && e.body?.id) intelRuns = upsertIntelRun(intelRuns, e.body as Run);
      const text = describe(e);
      if (text) last = { at: e.at, text };
    }
    set({ state: "live", message: null, checkedAt: new Date().toISOString(), last, intelRuns });
    if (page.events.length || page.gap) listeners.forEach((l) => l(page.events, !!page.gap));
    return POLL_MS;
  } catch (e) {
    set({ state: "error", message: e instanceof Error ? e.message : String(e) });
    return 0;
  }
}

/** Runs the poller while mounted. Mount once, near the root. */
export function useLiveFeed() {
  useEffect(() => {
    if (!isHostedWeb() && !isTauri()) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let backoff = POLL_MS;
    let busy = false;
    set({ state: "connecting", message: null });
    const tick = async () => {
      // Hidden: stop until visibilitychange resumes it. Busy: the running poll reschedules itself.
      if (stopped || busy || document.visibilityState !== "visible") return;
      busy = true;
      const wait = await poll();
      busy = false;
      backoff = wait === 0 ? Math.min(backoff * 2, MAX_BACKOFF_MS) : POLL_MS;
      if (!stopped) timer = setTimeout(() => void tick(), wait === 0 ? backoff : wait);
    };
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      clearTimeout(timer);
      void tick();
    };
    document.addEventListener("visibilitychange", onVisible);
    void tick();
    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);
}

/** Lets the Mac app tell the site about its own agents' runs, for the website. */
export async function publishLocal(events: { kind: "intel_run"; repo: string | null; body: unknown }[]) {
  if (!isTauri() || !events.length) return;
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("live_publish", { events });
}
