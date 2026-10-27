import { useEffect, useMemo, useRef, useState } from "react";
import { AtlasMark, Icon, type IconName } from "./components/Icon";
import { DetailPanel } from "./components/DetailPanel";
import { useAtlas, type View } from "./state";
import { attentionItems } from "./lib/derive";
import { agentMatches, repoMatches, repoRows } from "./lib/search";
import { relative } from "./lib/time";
import { MissionControl } from "./views/MissionControl";
import { GridView } from "./views/Grid";
import { ActivityView } from "./views/Activity";
import { ViewSwitch } from "./components/ViewSwitch";
import { AgentsView } from "./views/Agents";
import { ReposView } from "./views/Repos";
import { MapView } from "./views/Map";
import { SettingsView } from "./views/Settings";
import { IntelligenceView } from "./views/Intelligence";
import { useActions } from "./actions/state";
import { UpdateButton } from "./components/UpdateButton";

const NAV: { view: View; label: string; icon: IconName }[] = [
  { view: "map", label: "Map", icon: "map" },
  { view: "overview", label: "Mission", icon: "overview" },
  { view: "agents", label: "Agents", icon: "agents" },
  { view: "activity", label: "Activity", icon: "pulse" },
  { view: "intel", label: "Intel", icon: "spark" },
  { view: "repos", label: "Repos", icon: "repos" },
];

export default function App() {
  const { view, setView, catalog, repos, uncataloged, manifestIssues, refreshing, refresh, selection } = useAtlas();
  const actionsStatus = useActions().status;
  const rerunOn = !!actionsStatus?.config.rerun_failed_jobs.enabled && actionsStatus.config.rerun_failed_jobs.repos.length > 0;
  const attention = useMemo(() => attentionItems(catalog, repos, manifestIssues, Date.now(), uncataloged), [catalog, repos, manifestIssues, uncataloged]);

  const lastFetched = useMemo(() => {
    const times = Object.values(repos).flatMap((r) => (r.kind === "ok" ? [r.data.fetchedAt] : r.kind === "error" && r.data ? [r.data.fetchedAt] : []));
    times.sort();
    return times[times.length - 1];
  }, [repos]);

  return (
    <div className="shell">
      <header className="header">
        <div className="brand">
          <div className="brand-mark">
            <AtlasMark />
          </div>
          <div>
            <div className="brand-title">
              AI Ops Atlas<sup>01</sup>
            </div>
            <div className="eyebrow">Agents · Projects · Repositories</div>
          </div>
        </div>
        <div className="spacer" />
        <ViewSwitch />
        <GlobalSearch />
        <div className="refresh" title={lastFetched ? `GitHub data fetched ${new Date(lastFetched).toLocaleString()}` : "GitHub data not fetched yet"}>
          <button className="icon-btn" onClick={() => void refresh(true)} aria-label="Refresh GitHub data" disabled={refreshing}>
            <Icon name="refresh" size={16} className={refreshing ? "spin" : undefined} />
          </button>
          {refreshing ? "Refreshing…" : lastFetched ? `Synced ${relative(lastFetched)}` : "Not synced"}
        </div>
        <UpdateButton />
        {rerunOn ? (
          <span className="pill-mode" title="Read-only, except Re-run failed jobs on the repositories ticked in Settings. Each re-run needs your approval in a macOS dialog and is written to the audit log.">
            <span className="dot" />
            Read-only + re-runs
          </span>
        ) : (
          <span className="pill-mode" title="Nothing in the app can start agents or change repositories. Repository intelligence only reads GitHub, and sends repository data to Anthropic for analysis when you run it.">
            <span className="dot" />
            Read-only
          </span>
        )}
      </header>

      <nav className="sidebar" aria-label="Sections">
        {NAV.map((n) => (
          <button key={n.view} className={`nav-item ${view === n.view ? "active" : ""}`} onClick={() => setView(n.view)} aria-current={view === n.view ? "page" : undefined}>
            <Icon name={n.icon} size={20} />
            <span>{n.label}</span>
            {n.view === "overview" && attention.length > 0 && <span className="badge">{attention.length}</span>}
          </button>
        ))}
        <div className="grow" />
        <button className={`nav-item ${view === "settings" ? "active" : ""}`} onClick={() => setView("settings")}>
          <Icon name="settings" size={20} />
          <span>Settings</span>
        </button>
      </nav>

      <main className="main">
        {view === "overview" && <MissionControl attention={attention} />}
        {view === "grid" && <GridView />}
        {view === "activity" && <ActivityView />}
        {view === "agents" && <AgentsView />}
        {view === "repos" && <ReposView />}
        {view === "map" && <MapView />}
        {view === "intel" && <IntelligenceView />}
        {view === "settings" && <SettingsView />}
      </main>

      {/* The map docks its own inspector, and Agents shows the selected agent inline. */}
      {selection && view !== "map" && !(view === "agents" && selection.kind === "agent") && <DetailPanel />}
    </div>
  );
}

function GlobalSearch() {
  const { catalog, repos, uncataloged, filters, setFilters, select, setView, view } = useAtlas();
  const [open, setOpen] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const q = filters.query;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        input.current?.focus();
        input.current?.select();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const results = useMemo(() => {
    if (!q.trim()) return [];
    const agents = catalog.agents
      .filter((a) => agentMatches(a, catalog.projects.find((p) => p.id === a.projectId), q))
      .map((a) => ({ kind: "agent" as const, id: a.id, title: a.name, meta: `Agent · ${a.framework}` }));
    const rs = repoRows(catalog, repos, uncataloged)
      .filter((r) => repoMatches(r, q))
      .map((r) => ({ kind: "repo" as const, id: r.name, title: r.name, meta: `Repository · ${r.project?.name ?? "Not in the catalog"}` }));
    return [...agents, ...rs].slice(0, 8);
  }, [q, catalog, repos, uncataloged]);

  // The list views filter in place, so the popover is only needed elsewhere.
  const showPopover = open && q.trim() && view !== "agents" && view !== "repos" && view !== "grid";

  return (
    <div style={{ position: "relative" }}>
      <label className="search">
        <Icon name="search" size={15} />
        <input
          ref={input}
          value={q}
          placeholder="Search agents, repos, frameworks"
          onChange={(e) => setFilters({ query: e.target.value })}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={(e) => {
            if (e.key === "Escape") setFilters({ query: "" });
            if (e.key === "Enter" && results[0]) select({ kind: results[0].kind, id: results[0].id });
          }}
          aria-label="Search"
        />
        <kbd>⌘K</kbd>
      </label>
      {showPopover && (
        <div className="card" style={{ position: "absolute", top: 44, left: 0, right: 0, zIndex: 20, padding: 6 }}>
          {results.length === 0 && <div className="empty small">No matches</div>}
          {results.map((r) => (
            <button key={`${r.kind}:${r.id}`} className="list-row" onMouseDown={(e) => e.preventDefault()} onClick={() => select({ kind: r.kind, id: r.id })}>
              <span className="kind-icon">
                <Icon name={r.kind === "agent" ? "agents" : "repos"} size={14} />
              </span>
              <span className="grow">
                <div className="title">{r.title}</div>
                <div className="meta">{r.meta}</div>
              </span>
            </button>
          ))}
          {results.length > 0 && (
            <button className="text-btn small" style={{ margin: "4px 6px" }} onMouseDown={(e) => e.preventDefault()} onClick={() => setView("agents")}>
              Show all matching agents
            </button>
          )}
        </div>
      )}
    </div>
  );
}
