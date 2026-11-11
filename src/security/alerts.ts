import { useEffect, useSyncExternalStore } from "react";
import { isHostedWeb, isTauri } from "../lib/env";
import { ALERT_KINDS, MAX_REPOS, REPO_RE, SEVERITIES, type AlertFeed, type RepoAlerts, type SecuritySnapshot, type Severity } from "./types";

// Open GitHub security alerts for the Security Operations Center. The site counts them with its own
// GitHub token (server/security.ts); the page asks /api/security behind Access, the Mac app asks
// through its Rust shell with the website sync key. Only counts and severities come back. Polled
// only while the window is visible and the list is on screen.

export interface SecurityState {
  state: "loading" | "ready" | "off" | "error";
  message: string | null;
  value: SecuritySnapshot | null;
}

const EVERY_MS = 10 * 60_000;

let current: SecurityState = { state: "loading", message: null, value: null };
let asked = "";
const watchers = new Set<() => void>();
const set = (next: SecurityState) => {
  current = next;
  watchers.forEach((w) => w());
};
const subscribe = (w: () => void) => {
  watchers.add(w);
  return () => watchers.delete(w);
};

/** The catalog's repositories, deduplicated and well formed, as the site will accept them. */
export function securityRepos(repos: (string | undefined | null)[]): string[] {
  return [...new Set(repos.filter((r): r is string => !!r && REPO_RE.test(r)))].sort().slice(0, MAX_REPOS);
}

async function fetchAlerts(repos: string[]): Promise<SecuritySnapshot | null> {
  if (isHostedWeb()) {
    const r = await fetch(`/api/security?repos=${encodeURIComponent(repos.join(","))}`, { credentials: "same-origin", cache: "no-store" });
    if (!r.ok) throw new Error(((await r.json().catch(() => null)) as { message?: string } | null)?.message ?? `The site answered ${r.status}.`);
    return (await r.json()) as SecuritySnapshot;
  }
  if (isTauri()) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<SecuritySnapshot | null>("live_security", { repos });
  }
  return null;
}

export async function refreshSecurity(repos: string[]) {
  try {
    const v = await fetchAlerts(repos);
    set(v ? { state: "ready", message: null, value: v } : { state: "off", message: isTauri() ? "Security alerts come through website sync (Settings → Website sync)." : "Security alerts are read by the hosted site and the Mac app.", value: null });
  } catch (e) {
    set({ ...current, state: "error", message: e instanceof Error ? e.message : String(e) });
  }
}

const visible = () => typeof document === "undefined" || document.visibilityState === "visible";
let users = 0;
let timer: ReturnType<typeof setInterval> | null = null;

/** The shared alert counts for these repositories; polls while at least one component uses it. */
export function useSecurityAlerts(repos: string[]): SecurityState {
  const key = repos.join(",");
  useEffect(() => {
    const list = key ? key.split(",") : [];
    if (!list.length) return;
    if (users++ === 0 || asked !== key) {
      asked = key;
      void refreshSecurity(list);
      if (timer) clearInterval(timer);
      timer = setInterval(() => visible() && void refreshSecurity(list), EVERY_MS);
    }
    return () => {
      if (--users === 0 && timer) {
        clearInterval(timer);
        timer = null;
      }
    };
  }, [key]);
  return useSyncExternalStore(subscribe, () => current, () => current);
}

export type RepoSecurity = "clear" | "attention" | "unknown";

/** Open alerts across a repository's readable feeds, and its severity counts added up. */
export function repoTotals(r: RepoAlerts): { open: number; more: boolean; severity: Partial<Record<Severity, number>>; read: number } {
  const severity: Partial<Record<Severity, number>> = {};
  let open = 0, more = false, read = 0;
  for (const k of ALERT_KINDS) {
    const f = r.feeds[k];
    if (f.state !== "ok") continue;
    read++;
    open += f.open;
    more ||= f.more;
    for (const s of SEVERITIES) if (f.severity[s]) severity[s] = (severity[s] ?? 0) + f.severity[s]!;
  }
  return { open, more, severity, read };
}

/**
 * A repository's state from what GitHub returned: attention when any feed has open alerts, clear only
 * when every feed was read and none has any, unknown otherwise (a feed off, unreadable or failed).
 */
export function repoSecurity(r: RepoAlerts): RepoSecurity {
  const t = repoTotals(r);
  if (t.open > 0) return "attention";
  return ALERT_KINDS.every((k) => r.feeds[k].state === "ok") ? "clear" : "unknown";
}

/** "3 high, 1 medium" style text, most severe first. */
export function severityText(severity: Partial<Record<Severity, number>>): string {
  return SEVERITIES.filter((s) => severity[s]).map((s) => `${severity[s]} ${s}`).join(", ");
}

export const feedNote = (f: AlertFeed) => (f.state === "ok" ? `${f.open}${f.more ? "+" : ""} open` : f.state === "off" ? "off" : f.state === "no-access" ? "no access" : "unavailable");
