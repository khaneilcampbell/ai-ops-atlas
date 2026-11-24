import type { Agent } from "../catalog/types";
import type { Ownership } from "../catalog/ownership";
import { n8nWorkflowIds } from "../n8n/links";
import { runtimeOf, type RegistryEntry } from "../registry/registry";

// The Automations Board: every automation under the agent that owns it (catalog owned_by), with
// what needs Khaneil first. Pure functions, so the counts are tested without React. Nothing here
// invents a number: run counts come only from loaded telemetry, and are null when none is loaded.

const DAY = 24 * 60 * 60 * 1000;

/** Published in n8n is `active`; an unpublished draft is `paused` with "draft" in its trigger. */
export const isDraft = (e: RegistryEntry) => e.status === "paused" && /draft/i.test(e.profile.execution.trigger ?? "");
/** `idle` in the catalog: runs only when Khaneil presses a button or runs it by hand. */
export const isManual = (e: RegistryEntry) => e.status === "idle";
export const needsAttention = (e: RegistryEntry) => e.operational === "failing" || isDraft(e);

/** "Agent Ops · Registry Sheet Sync" reads as "Registry Sheet Sync" inside its owner's lane. */
export const shortTitle = (title: string) => title.split(" · ").slice(1).join(" · ") || title;

/** The first link to the automation's n8n workflow, for "Open in n8n". */
export function n8nUrl(agent: Pick<Agent, "links"> | undefined): string | null {
  if (!agent) return null;
  const id = n8nWorkflowIds(agent)[0];
  return id ? (agent.links.find((l) => l.url.includes(`/workflow/${id}`))?.url ?? null) : null;
}

/** Newest first, completed runs on the default branch only, at most `n`. */
export function recentRuns(e: RegistryEntry, n = 14) {
  return e.telemetry.executions.filter((x) => !x.offMainline && (x.result === "success" || x.result === "failure")).slice(0, n);
}

/** A short runtime family for chips and cards: the catalog's runtime text is too varied to filter on. */
export function runtimeFamily(e: RegistryEntry): string {
  const r = runtimeOf(e);
  if (/n8n/i.test(r)) return "n8n";
  if (/github/i.test(r)) return "GitHub Actions";
  if (/cloudflare/i.test(r)) return "Cloudflare";
  if (/desktop/i.test(r)) return "Desktop app";
  if (/atlas/i.test(r)) return "Atlas site";
  if (r === "Not documented") return r;
  return "Local or lab";
}

export interface Lane {
  /** Owning agent id, or "" for automations with no owner. */
  ownerId: string;
  automations: RegistryEntry[];
  live: number;
  drafts: number;
  manual: number;
  failing: number;
}

/** One lane per owning agent, most in need of attention first, then by size, then by id. */
export function buildLanes(entries: readonly RegistryEntry[], owns: Ownership): Lane[] {
  const byId = new Map(entries.map((e) => [e.profile.id, e]));
  const lanes: Lane[] = [];
  const add = (ownerId: string, automations: RegistryEntry[]) => {
    if (!automations.length) return;
    lanes.push({
      ownerId,
      automations: [...automations].sort((a, b) => Number(needsAttention(b)) - Number(needsAttention(a))),
      live: automations.filter((e) => e.status === "active").length,
      drafts: automations.filter(isDraft).length,
      manual: automations.filter(isManual).length,
      failing: automations.filter((e) => e.operational === "failing").length,
    });
  };
  for (const [ownerId, autos] of owns.owned) add(ownerId, autos.flatMap((a) => byId.get(a.id) ?? []));
  add("", owns.orphans.flatMap((a) => byId.get(a.id) ?? []));
  const score = (l: Lane) => l.failing * 100 + l.drafts * 10 + (l.ownerId ? 0 : 50);
  return lanes.sort((a, b) => score(b) - score(a) || b.automations.length - a.automations.length || a.ownerId.localeCompare(b.ownerId));
}

export interface BoardKpis {
  total: number;
  verified: number;
  drafts: number;
  /** Null when no live run data is loaded, so the board says "Not loaded yet" instead of 0. */
  failed24h: number | null;
  runs24h: number | null;
}

export function boardKpis(entries: readonly RegistryEntry[], now = Date.now()): BoardKpis {
  const loaded = entries.some((e) => e.telemetry.source && e.telemetry.loaded);
  const since = (e: RegistryEntry) => recentRuns(e, Infinity).filter((x) => now - Date.parse(x.at) < DAY);
  return {
    total: entries.length,
    verified: entries.filter((e) => e.operational === "verified").length,
    drafts: entries.filter(isDraft).length,
    failed24h: loaded ? entries.filter((e) => since(e).some((x) => x.result === "failure")).length : null,
    runs24h: loaded ? entries.reduce((n, e) => n + since(e).length, 0) : null,
  };
}

export type Chip = "all" | "attention" | "drafts" | "manual" | `runtime:${string}`;

export function chipMatches(chip: Chip, e: RegistryEntry): boolean {
  if (chip === "all") return true;
  if (chip === "attention") return needsAttention(e);
  if (chip === "drafts") return isDraft(e);
  if (chip === "manual") return isManual(e);
  return runtimeFamily(e) === chip.slice("runtime:".length);
}
