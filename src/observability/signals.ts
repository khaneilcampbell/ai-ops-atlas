import type { RepoState } from "../github/types";
import type { LiveStatus } from "../live/feed";
import type { N8nState } from "../n8n/runs";
import type { SecurityState } from "../security/alerts";
import { INTEGRATION_SOURCE, type IntegrationId } from "../modules/integrations";
import { syncStatus } from "../lib/syncStatus";

// The Observability Center's first real list: the health of every signal Atlas itself reads, from
// the state each client already keeps in this session. It is not metrics, logs or traces of the
// connected systems (those capabilities stay planned); it says whether each feed Atlas depends on
// is answering, when it last did, and why not when it isn't. Nothing is polled here: the rows
// are derived from state the app already has.

/**
 * live: answered recently. stale: has data, but the newest answer is old. failing: the last
 * attempt failed. not-set-up: needs configuration before it can answer. off: not available on
 * this platform (a web-only or Mac-only source). loading: no answer yet this session.
 */
export type SignalState = "live" | "stale" | "failing" | "not-set-up" | "off" | "loading";

export interface SignalRow {
  id: IntegrationId;
  label: string;
  state: SignalState;
  /** When the source last answered, when known. */
  at: string | null;
  /** What the source says about itself, in plain words. */
  detail: string;
}

export interface SignalInputs {
  /** Every tracked repository's GitHub state. */
  repos: Record<string, RepoState | undefined>;
  tracked: Iterable<string>;
  /** How old the newest successful GitHub fetch may be before it counts as stale (ms). */
  staleAfterMs: number;
  live: LiveStatus;
  intel: { available: boolean; error: string | null; loaded: boolean; keyPresent: boolean | null };
  usage: { firstLoad: boolean; error: string | null; records: number };
  n8n: N8nState;
  security: SecurityState;
  now: number;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function github(i: SignalInputs): Omit<SignalRow, "id" | "label"> {
  const s = syncStatus(i.tracked, i.repos);
  const total = [...i.tracked].length;
  if (!s.lastFetched && !s.failing.length) return { state: "loading", at: null, detail: "No repository fetched yet" };
  if (s.failing.length === total && total > 0) return { state: "failing", at: s.lastFetched ?? null, detail: s.reasons[0] ?? "Every repository failed its last sync" };
  const age = s.lastFetched ? i.now - Date.parse(s.lastFetched) : Infinity;
  const detail = `${s.loaded} of ${total} repositories loaded${s.failing.length ? `, ${s.failing.length} failed their last sync` : ""}`;
  return { state: s.failing.length ? "failing" : age > i.staleAfterMs ? "stale" : "live", at: s.lastFetched ?? null, detail };
}

function liveFeed(l: LiveStatus): Omit<SignalRow, "id" | "label"> {
  switch (l.state) {
    case "live": return { state: "live", at: l.checkedAt, detail: l.last ? l.last.text : "Connected, nothing new yet" };
    case "connecting": return { state: "loading", at: l.checkedAt, detail: "Connecting" };
    case "error": return { state: "failing", at: l.checkedAt, detail: l.message ?? "The feed did not answer" };
    default: return { state: "off", at: null, detail: l.message ?? "No site to ask from here" };
  }
}

function intel(x: SignalInputs["intel"]): Omit<SignalRow, "id" | "label"> {
  if (!x.available) return { state: "off", at: null, detail: "Runs in the Mac app" };
  if (x.error) return { state: "failing", at: null, detail: x.error };
  if (!x.loaded) return { state: "loading", at: null, detail: "Reading agent status" };
  if (x.keyPresent === false) return { state: "not-set-up", at: null, detail: "No Anthropic key in the vault" };
  return { state: "live", at: null, detail: "Agent status loaded" };
}

function usage(x: SignalInputs["usage"]): Omit<SignalRow, "id" | "label"> {
  if (x.error) return { state: "failing", at: null, detail: x.error };
  if (x.firstLoad) return { state: "loading", at: null, detail: "Reading usage records" };
  return { state: x.records ? "live" : "not-set-up", at: null, detail: x.records ? plural(x.records, "usage record") : "No usage recorded yet" };
}

function fromSnapshot(s: N8nState | SecurityState, describe: (v: NonNullable<N8nState["value"] | SecurityState["value"]> & { state: "ok" }) => string): Omit<SignalRow, "id" | "label"> {
  const v = s.value;
  if (v?.state === "ok") return { state: "live", at: v.fetchedAt, detail: describe(v) };
  if (v?.state === "not-configured") return { state: "not-set-up", at: null, detail: `Needs ${v.need.charAt(0).toLowerCase()}${v.need.slice(1)}` };
  if (s.state === "error") return { state: "failing", at: null, detail: s.message ?? "Did not answer" };
  if (s.state === "off") return { state: "off", at: null, detail: s.message ?? "Not connected here" };
  return { state: "loading", at: null, detail: "Reading" };
}

/** One row per integration contract, in contract order. */
export function signalRows(i: SignalInputs): SignalRow[] {
  const by: Record<IntegrationId, () => Omit<SignalRow, "id" | "label">> = {
    github: () => github(i),
    "live-feed": () => liveFeed(i.live),
    // Agent reports arrive over the same feed, so they share its state.
    "agent-feed": () => ({ ...liveFeed(i.live), detail: i.live.state === "live" ? "Arrives with live updates" : liveFeed(i.live).detail }),
    "atlas-intel": () => intel(i.intel),
    "usage-sync": () => usage(i.usage),
    n8n: () => fromSnapshot(i.n8n, (v) => ("workflows" in v ? `${plural(v.workflows.length, "workflow")}, ${v.workflows.filter((w) => w.active).length} on` : "")),
    "github-security": () => fromSnapshot(i.security, (v) => ("repos" in v ? plural(v.repos.length, "repository", "repositories") + " read" : "")),
  };
  return INTEGRATION_SOURCE.map((c) => ({ id: c.id, label: c.label, ...by[c.id]() }));
}

export function signalCounts(rows: SignalRow[]): Record<SignalState, number> {
  const n: Record<SignalState, number> = { live: 0, stale: 0, failing: 0, "not-set-up": 0, off: 0, loading: 0 };
  for (const r of rows) n[r.state]++;
  return n;
}
