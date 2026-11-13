import { useEffect, useSyncExternalStore } from "react";
import type { Agent } from "../catalog/types";
import { isHostedWeb, isTauri } from "../lib/env";
import { FAILED, type N8nSnapshot, type N8nWorkflowRuns } from "./types";

// Recent n8n runs for the Workflow Automation Plant. The site reads n8n with KC's read-only key
// (server/n8n.ts); the page asks /api/n8n behind Access, the Mac app asks through its Rust shell
// with the website sync key. Neither ever sees the n8n key. Polled only while the window is
// visible and something on screen uses it.

export interface N8nState {
  state: "loading" | "ready" | "off" | "error";
  message: string | null;
  value: N8nSnapshot | null;
}

const EVERY_MS = 2 * 60_000;

let current: N8nState = { state: "loading", message: null, value: null };
const watchers = new Set<() => void>();
const set = (next: N8nState) => {
  current = next;
  watchers.forEach((w) => w());
};
const subscribe = (w: () => void) => {
  watchers.add(w);
  return () => watchers.delete(w);
};

async function fetchRuns(): Promise<N8nSnapshot | null> {
  if (isHostedWeb()) {
    const r = await fetch("/api/n8n", { credentials: "same-origin", cache: "no-store" });
    if (!r.ok) throw new Error(((await r.json().catch(() => null)) as { message?: string } | null)?.message ?? `The site answered ${r.status}.`);
    return (await r.json()) as N8nSnapshot;
  }
  if (isTauri()) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<N8nSnapshot | null>("live_n8n");
  }
  return null;
}

export async function refreshN8n() {
  try {
    const v = await fetchRuns();
    set(v ? { state: "ready", message: null, value: v } : { state: "off", message: isTauri() ? "n8n runs come through website sync (Settings → Website sync)." : "n8n runs are read by the hosted site and the Mac app.", value: null });
  } catch (e) {
    set({ ...current, state: "error", message: e instanceof Error ? e.message : String(e) });
  }
}

const visible = () => typeof document === "undefined" || document.visibilityState === "visible";
let users = 0;
let timer: ReturnType<typeof setInterval> | null = null;

/** The shared n8n run summary; polls while at least one component uses it. */
export function useN8nRuns(): N8nState {
  useEffect(() => {
    if (users++ === 0) {
      void refreshN8n();
      timer = setInterval(() => visible() && void refreshN8n(), EVERY_MS);
    }
    return () => {
      if (--users === 0 && timer) clearInterval(timer);
    };
  }, []);
  return useSyncExternalStore(subscribe, () => current, () => current);
}

/** Every n8n workflow id a catalog agent links to (links to …/workflow/<id> on its n8n instance), in link order. */
export function n8nWorkflowIds(agent: Pick<Agent, "links">): string[] {
  const out: string[] = [];
  for (const l of agent.links ?? []) {
    const m = /^https:\/\/[^/]+\/workflow\/([A-Za-z0-9]+)(?:[/?#]|$)/.exec(l.url);
    if (m && /n8n/i.test(new URL(l.url).hostname + l.label) && !out.includes(m[1])) out.push(m[1]);
  }
  return out;
}

/** The agent's main n8n workflow: the first one it links to. Its runs set the agent's health. */
export function n8nWorkflowId(agent: Pick<Agent, "links">): string | null {
  return n8nWorkflowIds(agent)[0] ?? null;
}

/**
 * Which catalog agent each n8n workflow belongs to, by workflow id. A workflow that is switched on
 * in n8n but missing here is live work the Atlas tabs don't show yet (see unlistedWorkflows).
 */
export function workflowOwners(agents: readonly Pick<Agent, "name" | "links">[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const a of agents) for (const id of n8nWorkflowIds(a)) if (!out.has(id)) out.set(id, a.name);
  return out;
}

/** Workflows switched on in n8n that no catalog agent links to, so no Atlas tab lists them yet. */
export function unlistedWorkflows(workflows: readonly Pick<N8nWorkflowRuns, "id" | "active">[], owners: ReadonlyMap<string, string>): string[] {
  return workflows.filter((w) => w.active && !owners.has(w.id)).map((w) => w.id);
}

export type N8nHealth = "failing" | "ok" | "idle" | "off";

/** A workflow's state from its runs only: failing if the newest finished run failed, idle when none was seen. */
export function n8nHealth(w: N8nWorkflowRuns): N8nHealth {
  if (!w.active) return "off";
  const last = w.runs.find((r) => r.status !== "running" && r.status !== "waiting" && r.status !== "new");
  if (!last) return "idle";
  return FAILED.has(last.status) ? "failing" : last.status === "success" ? "ok" : "idle";
}
