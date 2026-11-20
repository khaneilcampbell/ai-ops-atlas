import {financialBuildingMatches,financialBuildingAliases,financialDisplayName,landmarkMatches} from './lib/financialSearch';
import { isHostedWeb, isTauri } from "./lib/env";
import { Fragment, lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { AtlasMark, Icon, type IconName } from "./components/Icon";
import { DetailPanel } from "./components/DetailPanel";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { useAtlas, type View } from "./state";
import { sectionEntry, sectionOf, SIDEBAR_SECTIONS, tabOf, type Section } from "./lib/sections";
import { attentionItems, ciSummary } from "./lib/derive";
import { agentMatches, repoMatches, repoRows, prioritizeExact } from "./lib/search";
import { relative } from "./lib/time";
import { syncStatus } from "./lib/syncStatus";
import { MissionControl } from "./views/MissionControl";
import { GridView } from "./views/Grid";
import { ActivityView } from "./views/Activity";
import { ViewSwitch } from "./components/ViewSwitch";
import { AgentsView } from "./views/Agents";
import { ReposView } from "./views/Repos";
import { MapView } from "./views/Map";
import { SettingsView } from "./views/Settings";
import { IntelligenceView } from "./views/Intelligence";
import { UsageView } from "./views/Usage";
import { TaskCenterView } from "./views/tasks/TaskCenter";
import { WorkflowIntelligenceView } from "./views/workflows/WorkflowIntelligence";
import { BusinessView } from "./views/business/Business";
import { useAutoPush } from "./usage/sync";
import { useLiveFeed } from "./live/feed";
import { LivePill } from "./components/LivePill";
import { UpdateButton } from "./components/UpdateButton";
import { VaultLockedPill } from "./components/VaultGate";
import { PHONE_QUERY, useMedia } from "./lib/media";
import { publishWatches, useAlertNotifications, useAlerts } from "./alerts/state";
import { AlertPill } from "./views/AgentAlerts";
import { usePropertyIncidents, usePropertyNotifications, usePropertyPolling } from "./properties/state";
import { InstallHint } from "./components/InstallHint";
import { formatDateTime, useTimeZone } from "./lib/timezone";
import { ensureWorkspace } from "./views/product/ensureWorkspace";

// Workspace and administration load only when opened, so the map's first paint doesn't wait on them.
const WorkspaceView = lazy(() => import("./views/product/Workspace").then((m) => ({ default: m.WorkspaceView })));

/** On a phone the bar holds these four plus More; the other sections open from the More sheet. */
const PHONE_BAR: { view: View; label: string; icon: IconName }[] = [
  { view: "map", label: "Projects", icon: "map" },
  { view: "agents", label: "Agents", icon: "agents" },
  { view: "overview", label: "Mission", icon: "overview" },
  { view: "activity", label: "Activity", icon: "pulse" },
];

/** The page a section opens on remembers the tab used last this session. */
function useSectionNav() {
  const { view, setView } = useAtlas();
  const last = useRef<Partial<Record<string, View>>>({});
  useEffect(() => {
    last.current[sectionOf(view).id] = tabOf(view);
  }, [view]);
  return (section: Section) => setView(sectionEntry(section, last.current));
}

export default function App() {
  const { view, setView, catalog, repos, uncataloged, manifestIssues, refreshing, refresh, selection } = useAtlas();
  const phone = useMedia(PHONE_QUERY);
  useAutoPush();
  useLiveFeed();
  // Re-render every date and time when the zone changes in Settings.
  useTimeZone();
  const { open: alerts, watches } = useAlerts();
  useAlertNotifications(alerts);
  useEffect(() => publishWatches(watches), [watches]);
  usePropertyPolling();
  usePropertyNotifications(usePropertyIncidents().open);
  // Single owner: no setup popup. A device without a workspace gets the Benjaire one silently.
  useEffect(() => ensureWorkspace(), []);
  const attention = useMemo(() => attentionItems(catalog, repos, manifestIssues, Date.now(), uncataloged), [catalog, repos, manifestIssues, uncataloged]);

  const trackedRepositories = new Set([...catalog.projects.map(p => p.repository), ...catalog.agents.map(a => a.repository), ...uncataloged]);
  const sync = syncStatus(trackedRepositories, repos);
  const { lastFetched, loaded: loadedRepositories } = sync;
  const syncFailing = !refreshing && sync.failing.length > 0;
  const syncTitle = [
    lastFetched ? `Latest successful repository fetch: ${formatDateTime(lastFetched)}. Coverage is repositories with a saved snapshot; it does not mean every repository is current.` : "GitHub data not fetched yet",
    syncFailing ? `\n${sync.failing.length} of ${trackedRepositories.size} repositories failed their last sync, so they show saved data:\n${sync.reasons.map((r) => `• ${r}`).join("\n")}\nOpen Repositories for details, or check the GitHub token in Settings.` : "",
  ].join("");
  const ci = ciSummary([...trackedRepositories], repos);
  const platform = isTauri() ? "Desktop" : isHostedWeb() ? "Hosted web" : "Local preview";
  const section = sectionOf(view);
  const openSection = useSectionNav();

  return (
    <div className="shell">
      <header className="header">
        <div className="brand">
          <div className="brand-mark">
            <AtlasMark />
          </div>
          <div>
            <div className="brand-title">
              Atlas
            </div>
            <div className="eyebrow">Agents · Projects · Repositories</div>
          </div>
        </div>
        <div className="spacer" />
        <ViewSwitch badge={attention.length + alerts.length} />
        <GlobalSearch />
        <div className={`refresh${syncFailing ? " sync-failing" : ""}`} title={syncTitle}>
          <button className="icon-btn" onClick={() => void refresh(true)} aria-label="Refresh GitHub data" disabled={refreshing}>
            <Icon name="refresh" size={16} className={refreshing ? "spin" : undefined} />
          </button>
          <span className="sync-evidence"><b>{refreshing ? "Refreshing…" : lastFetched ? `Latest ${relative(lastFetched)}` : "Not synced"}</b><small>{syncFailing ? `${sync.failing.length}/${trackedRepositories.size} failed to sync` : `${loadedRepositories}/${trackedRepositories.size} repositories loaded`}</small></span>
        </div>
        {platform !== "Desktop" && <span className="platform-label" title={platform === "Local preview" ? "Local preview · public GitHub data only. Private repository access is configured in the desktop app or hosted server." : `${platform} · connection settings apply to this version`}>{platform}</span>}
        <LivePill />
        <AlertPill open={alerts} />
        <VaultLockedPill />
        <UpdateButton />
        <button
          className={`pill-mode ci-pill ${ci.failing.length ? "bad" : ci.checked ? "good" : ""}`}
          onClick={() => setView("overview")}
          title={ci.failing.length ? `CI failing on ${ci.failing.join(", ")}. Open Mission Control.` : ci.checked ? `CI passing on ${ci.passing} of ${ci.checked} repositories with checks. Open Mission Control.` : "CI not checked yet. Open Mission Control."}
        >
          <span className="dot" />
          <span className="ci-long">{ci.failing.length ? `CI ${ci.failing.length} failing` : ci.checked ? `CI ${ci.passing}/${ci.checked} passing` : "CI not checked"}</span>
          <span className="ci-short" aria-hidden>{ci.failing.length ? `${ci.failing.length} failing` : ci.checked ? "CI ok" : "CI –"}</span>
        </button>
      </header>

      {phone ? (
        <PhoneNav
          attention={attention.length + alerts.length}
          status={{
            sync: refreshing ? "Refreshing…" : lastFetched ? `Latest sync ${relative(lastFetched)}` : "Not synced yet",
            coverage: syncFailing ? `${sync.failing.length} of ${trackedRepositories.size} repositories failed to sync and show saved data` : `${loadedRepositories} of ${trackedRepositories.size} repositories loaded`,
            failing: syncFailing,
            ci: ci.failing.length ? `CI failing on ${ci.failing.join(", ")}` : ci.checked ? `CI passing on ${ci.passing} of ${ci.checked} repositories with checks` : "CI not checked yet",
            ciBad: ci.failing.length > 0,
            platform,
          }}
        />
      ) : (
        <nav className="sidebar" aria-label="Sections">
          {SIDEBAR_SECTIONS.map((s) => (
            <Fragment key={s.id}>
              {s.id === "settings" && <div className="grow" />}
              <button className={`nav-item ${section.id === s.id ? "active" : ""}`} onClick={() => openSection(s)} aria-label={s.label} title={s.label} aria-current={section.id === s.id ? "page" : undefined}>
                <Icon name={s.icon} size={20} />
                <span>{s.label}</span>
              </button>
            </Fragment>
          ))}
        </nav>
      )}

      <main className="main">
        <InstallHint />
        {section.tabs.length > 1 && (
          <nav className="section-tabs tabs" aria-label={`${section.label} pages`}>
            {section.tabs.map((t) => (
              <button key={t.view} className={tabOf(view) === t.view ? "on" : undefined} aria-current={tabOf(view) === t.view ? "page" : undefined} onClick={() => setView(t.view)}>
                {t.label}
              </button>
            ))}
          </nav>
        )}
        {/* Keep one graphics context across navigation; MapView pauses while hidden. */}
        <div className={`projects-host${view === "map" ? "" : " inactive"}`} aria-hidden={view !== "map"} ref={el => { if (el) el.inert = view !== "map"; }}>
          <ErrorBoundary><MapView active={view === "map"}/></ErrorBoundary>
        </div>
        {/* Other pages still clear their own crashes when switching views. */}
        <ErrorBoundary key={view}>
          {view === "overview" && <MissionControl attention={attention} />}
          {view === "tasks" && <TaskCenterView />}
          {view === "workflows" && <WorkflowIntelligenceView />}
          {view === "business" && <BusinessView />}
          {view === "grid" && <GridView />}
          {view === "activity" && <ActivityView />}
          {view === "agents" && <AgentsView key="agents" kind="agents" />}
          {view === "automations" && <AgentsView key="automations" kind="automations" />}
          {view === "repos" && <ReposView />}
          {view === "intel" && <IntelligenceView />}
          {view === "review" && <IntelligenceView review />}
          {view === "usage" && <UsageView />}
          {view === "workspace" && (
            <Suspense fallback={<div className="page muted">Loading…</div>}>
              <WorkspaceView />
            </Suspense>
          )}
          {view === "settings" && <SettingsView part="connections" />}
          {view === "preferences" && <SettingsView part="preferences" />}
        </ErrorBoundary>
      </main>

      {/* The map docks its own inspector, and Agents shows the selected agent inline. */}
      {selection && view !== "map" && !((view === "agents" || view === "automations") && selection.kind === "agent" && !phone) && <DetailPanel />}
    </div>
  );
}

interface PhoneStatus { sync: string; coverage: string; failing: boolean; ci: string; ciBad: boolean; platform: string }

/**
 * The phone tab bar: four tabs that always fit, plus More. More opens a sheet with the other
 * sections and the sync and CI status the narrow header has no room for, so nothing sits
 * off-screen in a sideways-scrolling bar.
 */
function PhoneNav({ attention, status }: { attention: number; status: PhoneStatus }) {
  const { view, setView } = useAtlas();
  const [open, setOpen] = useState(false);
  const openSection = useSectionNav();
  // The bar tab for this page: its own tab, else the bar tab of its section. None means More.
  const current = PHONE_BAR.find((b) => b.view === tabOf(view)) ?? PHONE_BAR.find((b) => sectionOf(b.view).id === sectionOf(view).id);
  const more = SIDEBAR_SECTIONS.filter((s) => !PHONE_BAR.some((b) => sectionOf(b.view).id === s.id));
  const inMore = !current;
  const go = (v: View) => {
    setView(v);
    setOpen(false);
  };
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
  return (
    <>
      <nav className="sidebar phone-tabs" aria-label="Sections">
        {PHONE_BAR.map((n) => (
          <button key={n.view} className={`nav-item ${current === n && !open ? "active" : ""}`} onClick={() => go(n.view)} aria-label={n.label} aria-current={current === n ? "page" : undefined}>
            <Icon name={n.icon} size={20} />
            <span>{n.label}</span>
            {n.view === "overview" && attention > 0 && <span className="badge">{attention}</span>}
          </button>
        ))}
        <button className={`nav-item ${inMore || open ? "active" : ""}`} onClick={() => setOpen((o) => !o)} aria-label="More sections" aria-expanded={open} aria-haspopup="dialog">
          <Icon name="more" size={20} />
          <span>{inMore && !open ? sectionOf(view).label : "More"}</span>
          {status.failing && <span className="badge warn" aria-label="Sync problem">!</span>}
        </button>
      </nav>
      {open && (
        <>
          <div className="scrim more-scrim" onClick={() => setOpen(false)} />
          <div className="more-sheet" role="dialog" aria-label="More sections">
            <div className={`more-status${status.failing ? " bad" : ""}`}>
              <div><b>{status.sync}</b><small>{status.coverage}</small></div>
              <div className={status.ciBad ? "ci bad" : "ci"}><span className="dot" />{status.ci}</div>
              <small className="muted">{status.platform === "Hosted web" ? "Hosted web · read-only. Changes that write to GitHub open on GitHub or run in the Mac app." : status.platform}</small>
            </div>
            <ul className="more-list">
              {more.map((n) => (
                <li key={n.id}>
                  <button className={sectionOf(view).id === n.id ? "active" : undefined} onClick={() => { openSection(n); setOpen(false); }} aria-current={sectionOf(view).id === n.id ? "page" : undefined}>
                    <Icon name={n.icon} size={18} />
                    <span>{n.label}</span>
                    <span className="more-go" aria-hidden>›</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
    </>
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
    const projects = catalog.projects.filter(p => repoMatches({ name: p.repository, project: p, projects: [p], agents: [], state: undefined }, q)).map(p => ({ kind: "project" as const, id: p.id, title: p.name, aliases: p.formerNames, meta: "Project · Building" }));
    const buildings=financialBuildingMatches(q).map(b=>({kind:"service" as const,id:`financial:${b.id}`,title:financialDisplayName(b),aliases:financialBuildingAliases(b.id),meta:"Financial District · Planned · Not connected"}));
    const landmarks=landmarkMatches(q).map(n=>({kind:"service" as const,id:n.key.slice(8),title:n.displayName,aliases:n.formerNames,meta:"Landmark · Planned"}));
    return prioritizeExact([...projects, ...landmarks, ...buildings, ...agents, ...rs],q).slice(0, 8);
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
