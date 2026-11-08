import { useEffect, useMemo, useState } from "react";
import { useActions } from "../actions/state";
import { useAlerts } from "../alerts/state";
import { useProposals } from "../approvals/state";
import { useIntel } from "../intel/state";
import type { AttentionItem } from "../lib/derive";
import { buildRegistry } from "../registry/registry";
import { useAtlas } from "../state";
import { FixWithClaude } from "../components/FixWithClaude";
import { FIX_QUEUE_REPO, type FixRequest } from "../lib/fixWithClaude";
import "../styles/mission-focus.css";

type Scope = "all" | "high" | "agent" | "repo";
const SCOPES: { id: Scope; label: string }[] = [
  { id: "all", label: "All" },
  { id: "high", label: "High priority" },
  { id: "agent", label: "Agents" },
  { id: "repo", label: "Repositories" },
];
const RANK = { high: 0, medium: 1, low: 2 } as const;
const SHOWN = 5;

/**
 * The top of Mission Control: everything that needs a look, highest priority first, with a filter
 * and the next step for each item. Production agents whose reports failed or went missing join the
 * manifest and GitHub items, unless Agent alerts below already lists them.
 */
export function MissionFocus({ attention }: { attention: AttentionItem[] }) {
  const { catalog, repos, select, setView, refreshing, refresh } = useAtlas();
  const { telemetry } = useIntel();
  const { watches } = useAlerts();
  const actionsAvailable = useActions().available;
  const pending = useProposals().length;
  const [scope, setScope] = useState<Scope>("all");
  const [expanded, setExpanded] = useState(false);
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const items = useMemo(() => {
    const watched = new Set(watches.map((w) => w.agent.id));
    const entries = buildRegistry(catalog, repos, telemetry ? { ...telemetry, observedAt: new Date(now).toISOString() } : null);
    const production: AttentionItem[] = entries
      .filter((e) => !watched.has(e.profile.id) && (e.operational === "unknown" || (e.telemetry.source === "production" && e.operational === "failing")))
      .map((e) => ({
        id: `production:${e.profile.id}`,
        severity: e.operational === "failing" ? "high" : "medium",
        title: e.profile.title,
        detail: e.operational === "failing" ? "Latest production run failed. Open the profile to inspect the run." : "Production status unknown. Check the agent's reporting connection.",
        target: { kind: "agent", id: e.profile.id },
      }));
    return [...production, ...attention].sort((a, b) => RANK[a.severity] - RANK[b.severity]);
  }, [catalog, repos, telemetry, watches, attention, now]);

  const filtered = items.filter((a) => scope === "all" || (scope === "high" ? a.severity === "high" : a.target?.kind === scope));
  const synced = Object.values(repos).filter((r) => r.kind === "ok" && !r.stale).length;
  const open = (a: AttentionItem) => {
    if (!a.target) return setView("settings");
    if (a.target.kind === "agent") setView("agents");
    select(a.target);
  };
  /** The repository a fix belongs in: the agent's, the repository itself, or Atlas for manifest problems. */
  const fixRequest = (a: AttentionItem): FixRequest => {
    const agent = a.target?.kind === "agent" ? catalog.agents.find((g) => g.id === a.target?.id) : undefined;
    const repo = a.target?.kind === "repo" ? a.target.id : (agent?.repository ?? FIX_QUEUE_REPO);
    const kind = a.target?.kind === "agent" ? "Agent needs attention" : a.target ? "Repository needs attention" : "Atlas setting or manifest";
    return { kind, title: a.title, detail: a.detail, repo, links: [{ label: "Repository", url: `https://github.com/${repo}` }] };
  };
  const toApprovals = () => {
    const queue = document.getElementById("mission-approvals");
    queue?.scrollIntoView({ behavior: "smooth", block: "start" });
    queue?.focus({ preventScroll: true });
  };

  return (
    <section className="card mission-focus" aria-labelledby="mission-focus-title">
      <div className="card-head">
        <div className="grow">
          <div className="eyebrow">Your next steps</div>
          <h2 id="mission-focus-title">{items.length ? `${items.length} ${items.length === 1 ? "item needs" : "items need"} a closer look` : "No issues in the available evidence"}</h2>
          <p className="muted small">{synced} repositories have current cached data. Agent status comes from observed activity; missing reports stay unknown.</p>
        </div>
        <button className="ghost-btn" disabled={refreshing} onClick={() => void refresh(true)}>
          {refreshing ? "Refreshing…" : "Refresh status"}
        </button>
      </div>
      <div className="mission-shortcuts">
        <button className="ghost-btn" onClick={() => setView("agents")}>Check agent activity</button>
        {actionsAvailable && pending > 0 && (
          <button className="ghost-btn" onClick={toApprovals}>
            Review {pending} pending {pending === 1 ? "approval" : "approvals"}
          </button>
        )}
      </div>
      <div className="mission-filters" role="group" aria-label="Filter attention items">
        {SCOPES.map((s) => (
          <button key={s.id} className="ghost-btn" aria-pressed={scope === s.id} onClick={() => { setScope(s.id); setExpanded(false); }}>
            {s.label}
          </button>
        ))}
      </div>
      <div aria-live="polite" className="muted small mission-result-count">
        {filtered.length} {filtered.length === 1 ? "item" : "items"}
      </div>
      {filtered.length === 0 ? (
        <div className="empty">{items.length ? "No items match this filter." : "Refresh status to check for new activity. Missing data does not establish that everything is healthy."}</div>
      ) : (
        <ul className="list">
          {(expanded ? filtered : filtered.slice(0, SHOWN)).map((a) => (
            <li key={a.id} className="mission-item">
              <button className="list-row" onClick={() => open(a)}>
                <span className={`sev ${a.severity}`} aria-label={`${a.severity} priority`} />
                <span className="grow">
                  <span className="title">{a.title}</span>
                  <span className="meta mission-item-detail">{a.detail}</span>
                </span>
                <span className="mission-next small">{a.target?.kind === "agent" ? "Open profile →" : a.target ? "Inspect repository →" : "Open settings →"}</span>
              </button>
              <FixWithClaude request={fixRequest(a)} />
            </li>
          ))}
        </ul>
      )}
      {filtered.length > SHOWN && (
        <button className="text-btn mission-expand" onClick={() => setExpanded(!expanded)}>
          {expanded ? "Show fewer" : `Show all ${filtered.length} items`}
        </button>
      )}
    </section>
  );
}
