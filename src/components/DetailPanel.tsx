import { orderToolsForWorkflow } from "../views/toolWorkflowLayout";
import { ToolWorkflow } from "./ToolWorkflow";
import { servicesOf, SERVICE_PURPOSE } from "../catalog/roles";
import { projectRepositories } from "../catalog/projects";
import { useEffect, useMemo, useState } from "react";
import { Icon } from "./Icon";
import { CopyValue, ExternalLink, HealthBadge, Indicator, LANG_COLORS, StatusPill } from "./bits";
import { activityFeed, attentionItems, effectiveLastRun, latestPerWorkflow, observedRun, overallHealth, repoData, repoHealth, type Health } from "../lib/derive";
import { frameworkColor } from "../views/mapLayout";
import { formatDate, relative } from "../lib/time";
import { useAtlas } from "../state";
import type { Agent } from "../catalog/types";
import { IntelPanel } from "./IntelPanel";
import { RerunButton } from "./RerunButton";
import { PullRequests } from "./PullRequests";
import { useReducedMotion } from "../lib/motion";
import { webglAvailable } from "../views/map3d/webgl";
import { enterBuilding } from "../views/office/store";
import { AgentOrganizationRows, GroupedAgents, ProjectOrganization } from "./Organization";
import { EditDetailsButton, EditFilesButton, InspectorEditRow } from "./edit/EditControls";

/** Details for the current selection: an overlay on list views, or docked beside the map. */
export function DetailPanel({ docked = false }: { docked?: boolean }) {
  const { selection, select } = useAtlas();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && select(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [select]);

  if (!selection) return null;
  const body = selection.kind === "agent" ? <AgentDetail id={selection.id} /> : selection.kind === "service" ? <ServiceDetail key={selection.id} id={selection.id} /> : selection.kind === "project" ? <ProjectDetail key={selection.id} id={selection.id} /> : <RepoDetail key={selection.id} name={selection.id} />;
  if (docked)
    return (
      <aside className="panel docked" aria-label="Inspector">
        {body}
      </aside>
    );
  return (
    <>
      <div className="scrim" onClick={() => select(null)} />
      <aside className="panel" role="dialog" aria-label="Details">
        {body}
      </aside>
    </>
  );
}

function Head({ eyebrow, title, children }: { eyebrow: string; title: string; children?: React.ReactNode }) {
  const { select } = useAtlas();
  return (
    <div className="panel-head">
      <div className="grow">
        <div className="eyebrow">{eyebrow}</div>
        <h2>{title}</h2>
        {children}
      </div>
      <button className="icon-btn" onClick={() => select(null)} aria-label="Close details" style={{ color: "var(--ink-2)" }}>
        <Icon name="close" />
      </button>
    </div>
  );
}

function ServiceDetail({ id }: { id: string }) {
  const { catalog, select } = useAtlas();
  const split = id.indexOf(":");
  const project = catalog.projects.find(p => p.id === id.slice(0, split));
  const service = project && servicesOf(catalog.agents.filter(a => a.projectId === project.id)).find(s => s.id === id.slice(split + 1));
  if (!project || !service) return <Head eyebrow="Infrastructure tool" title="Not found" />;
  const route = orderToolsForWorkflow(servicesOf(catalog.agents.filter(a => a.projectId === project.id)));
  return <>
    <Head eyebrow={`Infrastructure tool · ${project.name}`} title={service.name}>
      <div className="chips" style={{ marginTop: 10 }}><span className="chip">Supporting infrastructure</span><span className="chip">{service.users.length} linked {service.users.length === 1 ? "worker" : "workers"}</span></div>
    </Head>
    <div className="panel-body selectable">
      <section><div className="section-title">Purpose</div><p style={{ margin: 0, fontSize: 14 }}>{SERVICE_PURPOSE[service.id]}</p></section>
      <section><div className="section-title">Supports this project</div><button className="ghost-btn" onClick={() => select({ kind: "project", id: project.id })}><Icon name="map" size={15} />{project.name}</button></section>
      {route.length > 1 && <section><div className="section-title">Tool workflow · left to right around headquarters</div><div className="link-list">{route.map((tool, index) => <button key={tool.id} className="text-btn" aria-current={tool.id === service.id ? "step" : undefined} onClick={() => select({ kind: "service", id: `${project.id}:${tool.id}` })}>{index + 1}. {tool.name}{tool.id === service.id ? " · selected" : " →"}</button>)}</div><p className="muted small">Placement follows declared dependencies and documented workflow phases.</p></section>}
      <ToolWorkflow service={service} projectAgents={catalog.agents.filter(a => a.projectId === project.id)} />
      <section><div className="section-title">Linked repositories</div><div className="link-list">{[...new Set(service.users.map(a => a.repository))].map(name => <button key={name} className="text-btn" onClick={() => select({ kind: "repo", id: name })}><Icon name="repos" size={14}/>{name} →</button>)}</div></section>
    </div>
  </>;
}

/** A project owns its building and agents; repositories are linked resources. */
function ProjectDetail({ id }: { id: string }) {
  const { catalog, repos, select, view } = useAtlas();
  const reduced = useReducedMotion();
  const project = catalog.projects.find(p => p.id === id);
  if (!project) return <Head eyebrow="Project" title="Not found" />;
  const repositories = projectRepositories(project, catalog.agents);
  return <>
    <Head eyebrow="Project building" title={project.name}>
      <div className="chips" style={{ marginTop: 10 }}><StatusPill status={project.status} /><span className="chip">{repositories.length} {repositories.length === 1 ? "repository" : "repositories"}</span></div>
      <InspectorEditRow><EditDetailsButton target={project.file ? { kind: "project", file: project.file, name: project.name } : null} /></InspectorEditRow>
      {view === "map" && webglAvailable() && <button className="ghost-btn enter-building" onClick={() => enterBuilding(project.id, reduced)}><Icon name="agents" size={15} /> Enter building</button>}
    </Head>
    <div className="panel-body selectable">
      <p style={{ margin: 0, fontSize: 14 }}>{project.summary}</p>
      <section aria-label="Linked repositories">
        <div className="section-title">Linked repositories</div>
        <ul className="runs">{repositories.map(name => {
          const snapshot = repoData(repos[name]);
          return <li key={name} style={{ flexWrap: "wrap", gap: 8 }}>
            <span className="grow" style={{ minWidth: 0, overflowWrap: "anywhere" }}><ExternalLink href={`https://github.com/${name}`}><Icon name="repos" size={14} /> {name}</ExternalLink><span className="muted small" style={{ display: "block" }}>{name === project.repository ? "Default repository" : "Linked resource"}</span></span>
            <HealthBadge health={snapshot ? overallHealth(repoHealth(snapshot, catalog.agents.filter(a => a.projectId === id && a.repository === name).length)) : "unknown"} />
            <button className="text-btn" aria-label={`Inspect repository ${name}`} onClick={() => select({ kind: "repo", id: name })}>Inspect →</button>
          </li>;
        })}</ul>
      </section>
      <ProjectOrganization project={project} agents={catalog.agents.filter(a => a.projectId === project.id)} />
      {project.links.length > 0 && <section><div className="section-title">Project links</div><div className="link-list">{project.links.map(link => <ExternalLink key={link.url} href={link.url}><Icon name="external" size={14} /> {link.label}</ExternalLink>)}</div></section>}
    </div>
  </>;
}

function githubFileUrl(agent: Agent, branch = "HEAD") {
  return agent.source ? `https://github.com/${agent.repository}/blob/${branch}/${agent.source}` : undefined;
}

function AgentDetail({ id }: { id: string }) {
  const { catalog, repos, select } = useAtlas();
  const agent = catalog.agents.find((a) => a.id === id);
  const history = useMemo(() => activityFeed(catalog, repos, { agent: id }), [catalog, repos, id]);
  if (!agent) return <Head eyebrow="Agent" title="Not found" />;
  const project = catalog.projects.find((p) => p.id === agent.projectId);
  const snap = repoData(repos[agent.repository]);
  const last = effectiveLastRun(agent, snap);
  const run = observedRun(agent, snap);
  const source = githubFileUrl(agent, snap?.defaultBranch);

  return (
    <>
      <Head eyebrow={`Agent · ${project?.name ?? agent.projectId}`} title={agent.name}>
        <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
          <StatusPill status={agent.status} />
          <span className="chip">{agent.framework}</span>
        </div>
        <InspectorEditRow>
          <EditDetailsButton target={project?.file ? { kind: "agent", file: project.file, id: agent.id, name: agent.name } : null} />
        </InspectorEditRow>
      </Head>
      <div className="panel-body selectable">
        <p style={{ margin: 0, fontSize: 14 }}>{agent.purpose}</p>
        <dl className="kv">
          <dt>Project</dt>
          <dd>{project?.name}</dd>
          <AgentOrganizationRows id={agent.id} />
          <dt>Repository</dt>
          <dd>
            <button className="text-btn" style={{ padding: 0 }} onClick={() => select({ kind: "repo", id: agent.repository })}>
              {agent.repository}
            </button>
          </dd>
          {agent.model && (
            <>
              <dt>Model</dt>
              <dd>{agent.model}</dd>
            </>
          )}
          {agent.runtime && (
            <>
              <dt>Runtime</dt>
              <dd>{agent.runtime}</dd>
            </>
          )}
          {agent.trigger && (
            <>
              <dt>Trigger</dt>
              <dd>{agent.trigger}</dd>
            </>
          )}
          {agent.source && (
            <>
              <dt>Source</dt>
              <dd className="mono">
                <CopyValue value={agent.source} title="Copy source path" />
              </dd>
            </>
          )}
          <dt>Last run</dt>
          <dd>
            {last ? `${formatDate(last)} (${relative(last)})` : <span className="muted">Not recorded in the manifest</span>}
            {run && <div className="muted small">From GitHub Actions: {run.conclusion ?? run.status}</div>}
          </dd>
        </dl>
        <div>
          <div className="section-title">Links</div>
          <div className="links">
            {source && (
              <ExternalLink href={source}>
                <Icon name="external" size={14} /> Source on GitHub
              </ExternalLink>
            )}
            <ExternalLink href={`https://github.com/${agent.repository}`}>
              <Icon name="external" size={14} /> Repository
            </ExternalLink>
            {agent.links.map((l) => (
              <ExternalLink key={l.url} href={l.url}>
                <Icon name="external" size={14} /> {l.label}
              </ExternalLink>
            ))}
          </div>
        </div>
        <div>
          <div className="section-title">Activity history</div>
          {history.length === 0 ? (
            <div className="muted small">No history recorded yet. Live run history arrives with the n8n and local adapters in the next phase.</div>
          ) : (
            <ul className="timeline">
              {history.map((h) => (
                <li key={h.id} className={`k-${h.kind}`}>
                  <div className="small">{h.url ? <ExternalLink href={h.url}>{h.title}</ExternalLink> : h.title}</div>
                  <div className="muted small">
                    {formatDate(h.at)} · {h.subtitle}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </>
  );
}

const CONCLUSION_HEALTH: Record<string, Health> = { success: "good", failure: "bad", timed_out: "bad", cancelled: "warn", action_required: "warn" };

type RepoTab = "overview" | "pulls" | "agents" | "activity" | "insights";
const REPO_TABS: { id: RepoTab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "pulls", label: "PRs" },
  { id: "agents", label: "Agents" },
  { id: "activity", label: "Activity" },
  { id: "insights", label: "Insights" },
];

function RepoDetail({ name }: { name: string }) {
  const { catalog, repos, select, setView, setFilters, clearFilters } = useAtlas();
  const [more, setMore] = useState(false);
  const [tab, setTab] = useState<RepoTab>("overview");
  const state = repos[name];
  const snap = repoData(state);
  const project = catalog.projects.find((p) => projectRepositories(p, catalog.agents).includes(name));
  const agents = catalog.agents.filter((a) => a.repository === name);
  const history = useMemo(() => activityFeed(catalog, repos, { repo: name }), [catalog, repos, name]);
  const indicators = repoHealth(snap, agents.length);
  const workflows = snap ? latestPerWorkflow(snap.runs) : [];
  const languages = snap ? Object.entries(snap.languages).sort((a, b) => b[1] - a[1]) : [];
  const total = languages.reduce((s, [, v]) => s + v, 0);
  const frameworks = [...new Set(agents.map((a) => a.framework))];
  const models = [...new Set(agents.flatMap((a) => (a.model ? [a.model] : [])))];

  return (
    <>
      <Head eyebrow={project ? "Repository · Project resource" : "Repository · Not in the catalog yet"} title={name.split("/")[1]}>
        <div className="mono muted" style={{ marginTop: 4 }}>
          <CopyValue value={name} title="Copy repository name" />
        </div>
        <div className="chips" style={{ marginTop: 10 }}>
          {project && <StatusPill status={project.status} />}
          <HealthBadge health={snap ? overallHealth(indicators) : "unknown"} />
          {snap && <span className="chip">{snap.visibility}</span>}
          {snap?.archived && <span className="chip">Archived</span>}
        </div>
        {project && <button className="ghost-btn" style={{ marginTop: 12 }} onClick={() => select({ kind: "project", id: project.id })}><Icon name="map" size={15} /> Back to {project.name}</button>}
        <InspectorEditRow>
          <EditDetailsButton target={project?.file ? { kind: "project", file: project.file, name: project.name } : null} />
          <EditFilesButton repo={name} />
        </InspectorEditRow>
      </Head>
      <div className="panel-tabs" role="tablist" aria-label="Inspector sections">
        {REPO_TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? "on" : ""} onClick={() => setTab(t.id)}>
            {t.label}
            {t.id === "agents" && agents.length > 0 && <span className="count">{agents.length}</span>}
          </button>
        ))}
      </div>
      <div className="panel-body selectable" role="tabpanel">
        {tab === "overview" && (
          <>
          {state?.kind === "error" && (
            <div className="notice">
              <Icon name="alert" size={15} /> <CopyValue value={state.message} title="Copy error" />
            </div>
          )}
          {(snap?.description ?? project?.summary) && <p style={{ margin: 0, fontSize: 14 }}>{snap?.description ?? project?.summary}</p>}

          {project && <ProjectOrganization project={project} agents={agents} latest={history[0]} />}

          <section>
            <div className="section-head">
              <div className="section-title">Verified health</div>
              <span className="source">{snap ? `GitHub · synced ${relative(snap.fetchedAt)}` : "Not synced yet"}</span>
            </div>
            <div className="health-grid">
              {indicators.map((i) => (
                <Indicator key={i.key} ind={i} />
              ))}
            </div>
            {workflows.length > 0 && (
              <ul className="runs">
                {workflows.map((r) => (
                  <li key={r.name}>
                    <i className={`h-${r.status !== "completed" ? "unknown" : (CONCLUSION_HEALTH[r.conclusion ?? ""] ?? "unknown")}`} />
                    <span className="grow">
                      <ExternalLink href={r.url}>{r.name}</ExternalLink>
                      <span className="muted"> · {r.status !== "completed" ? r.status.replace("_", " ") : r.conclusion}</span>
                    </span>
                    <span className="muted small" title={new Date(r.createdAt).toLocaleString()}>
                      {relative(r.createdAt)}
                    </span>
                    <RerunButton repo={name} run={r} />
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section>
            <div className="section-title">Tech stack</div>
            {total > 0 ? (
              <>
                <div className="lang-bar" role="img" aria-label={languages.map(([l, v]) => `${l} ${Math.round((v / total) * 100)}%`).join(", ")}>
                  {languages.map(([l, v]) => (
                    <i key={l} style={{ flexGrow: v, background: LANG_COLORS[l] ?? "var(--sage-400)" }} />
                  ))}
                </div>
                <div className="lang-legend">
                  {languages.slice(0, 5).map(([l, v]) => (
                    <span key={l} className="health">
                      <i className="lang-dot" style={{ background: LANG_COLORS[l] ?? "var(--sage-400)" }} />
                      {l} <span className="muted">{Math.round((v / total) * 100)}%</span>
                    </span>
                  ))}
                </div>
              </>
            ) : (
              <div className="muted small">{snap ? "GitHub reports no languages for this repository." : "Languages appear after the first sync."}</div>
            )}
            {(frameworks.length > 0 || models.length > 0 || (project?.tags.length ?? 0) > 0) && (
              <div className="chips" style={{ marginTop: 10 }}>
                {frameworks.map((f) => (
                  <span key={f} className="chip">
                    <i className="swatch" style={{ background: frameworkColor(f) }} />
                    {f}
                  </span>
                ))}
                {models.map((m) => (
                  <span key={m} className="chip">
                    {m}
                  </span>
                ))}
                {project?.tags.map((t) => (
                  <span key={t} className="chip muted-chip">
                    #{t}
                  </span>
                ))}
              </div>
            )}
          </section>

          <dl className="kv">
            <dt>Default branch</dt>
            <dd className="mono">{snap?.defaultBranch ?? "–"}</dd>
            <dt>Last push</dt>
            <dd>{snap?.pushedAt ? `${formatDate(snap.pushedAt)} (${relative(snap.pushedAt)})` : "–"}</dd>
            <dt>Stars</dt>
            <dd>{snap ? snap.stars : "–"}</dd>
            <dt>License</dt>
            <dd>{snap ? (snap.license ?? "None") : "–"}</dd>
          </dl>
          <div>
            <div className="section-title">Links</div>
            <div className="links">
              <ExternalLink href={`https://github.com/${name}`}>
                <Icon name="external" size={14} /> Open on GitHub
              </ExternalLink>
              {snap?.homepage && (
                <ExternalLink href={snap.homepage}>
                  <Icon name="external" size={14} /> {snap.homepage.replace(/^https?:\/\//, "")}
                </ExternalLink>
              )}
              {project?.links.map((l) => (
                <ExternalLink key={l.url} href={l.url}>
                  <Icon name="external" size={14} /> {l.label}
                </ExternalLink>
              ))}
              {project && agents.length > 0 && (
                <button
                  className="text-btn link-row"
                  onClick={() => {
                    clearFilters();
                    setFilters({ project: project.id });
                    setView("agents");
                  }}
                >
                  <Icon name="agents" size={14} /> List these agents
                </button>
              )}
              <button className="text-btn link-row" onClick={() => setView("repos")}>
                <Icon name="repos" size={14} /> All repositories
              </button>
            </div>
          </div>
          </>
        )}
        {tab === "agents" && (
          <>
            {agents.length === 0 ? (
              <section>
                <div className="section-title">Agents (0)</div>
                <div className="muted small">{project ? "No agents are registered for this project." : "Add a manifest in catalog/ to register this repository's agents."}</div>
              </section>
            ) : (
              <GroupedAgents agents={agents} onPick={(id) => select({ kind: "agent", id })} />
            )}
          </>
        )}
        {tab === "activity" && (
          <>
          <div>
            <div className="section-title">Recent activity</div>
            {history.length === 0 ? (
              <div className="muted small">{snap ? "No commits or workflow runs in the synced window." : "Activity appears after the first sync."}</div>
            ) : (
              <>
                <ul className="timeline">
                  {history.slice(0, more ? 20 : 6).map((h) => (
                    <li key={h.id} className={`k-${h.kind}`}>
                      <div className="small">{h.url ? <ExternalLink href={h.url}>{h.title}</ExternalLink> : h.title}</div>
                      <div className="muted small" title={new Date(h.at).toLocaleString()}>
                        {relative(h.at)} · {h.subtitle}
                      </div>
                    </li>
                  ))}
                </ul>
                {history.length > 6 && (
                  <button className="text-btn small" onClick={() => setMore((m) => !m)}>
                    {more ? "Show less" : `Show ${Math.min(20, history.length) - 6} more`}
                  </button>
                )}
              </>
            )}
          </div>
          </>
        )}
        {tab === "pulls" && <PullRequests repo={name} />}
        {tab === "insights" && <RepoInsights name={name} />}
      </div>
      <div className="panel-foot">
        <ExternalLink href={`https://github.com/${name}`} className="btn primary">
          <Icon name="external" size={14} /> Open repository
        </ExternalLink>
        {project && agents.length > 0 ? (
          <button className="btn" onClick={() => {
    if (!project) return;
    clearFilters();
    setFilters({ project: project.id });
    setView("agents");
  }}>
            <Icon name="agents" size={14} /> View agents
          </button>
        ) : (
          <button className="btn" onClick={() => setView("repos")}>
            <Icon name="repos" size={14} /> All repositories
          </button>
        )}
      </div>
    </>
  );
}

/** Facts computed from what Atlas has synced for one repository; nothing here is estimated. */
function RepoInsights({ name }: { name: string }) {
  const { catalog, repos, uncataloged, select } = useAtlas();
  const snap = repoData(repos[name]);
  const agents = catalog.agents.filter((a) => a.repository === name);
  const flags = useMemo(
    () => attentionItems(catalog, repos, [], Date.now(), uncataloged).filter((i) => i.target && (i.target.id === name || agents.some((a) => a.id === i.target!.id))),
    [catalog, repos, uncataloged, name, agents],
  );
  if (!snap)
    return (
      <>
        <div className="muted small">Insights appear after the first sync with GitHub.</div>
        <IntelPanel repo={name} />
      </>
    );
  const done = snap.runs.filter((r) => r.status === "completed");
  const ok = done.filter((r) => r.conclusion === "success").length;
  const since = Date.now() - 14 * 86_400_000;
  const recentCommits = snap.commits.filter((c) => Date.parse(c.date) >= since).length;
  const authors = new Set(snap.commits.map((c) => c.author)).size;
  const tiles = [
    { label: "CI success", value: done.length ? `${Math.round((ok / done.length) * 100)}%` : "–", note: done.length ? `${ok} of ${done.length} synced runs` : "No completed runs" },
    { label: "Commits, 14 days", value: String(recentCommits), note: `of the latest ${snap.commits.length} synced` },
    { label: "Last push", value: snap.pushedAt ? relative(snap.pushedAt) : "–", note: snap.pushedAt ? formatDate(snap.pushedAt) : "Not reported" },
    { label: "Contributors", value: String(authors), note: "in the synced commits" },
    { label: "Open issues + PRs", value: String(snap.openIssues), note: "Reported by GitHub" },
    { label: "Agents", value: String(agents.length), note: `${agents.filter((a) => a.status === "active").length} active` },
  ];
  return (
    <>
      <section>
        <div className="section-head">
          <div className="section-title">At a glance</div>
          <span className="source">GitHub · synced {relative(snap.fetchedAt)}</span>
        </div>
        <div className="insight-grid">
          {tiles.map((t) => (
            <div key={t.label} className="insight">
              <div className="label">{t.label}</div>
              <div className="value">{t.value}</div>
              <div className="note">{t.note}</div>
            </div>
          ))}
        </div>
      </section>
      <section>
        <div className="section-title">Worth a look</div>
        {flags.length === 0 ? (
          <div className="muted small">Nothing flagged for this repository or its agents.</div>
        ) : (
          <ul className="list" style={{ padding: 0 }}>
            {flags.map((f) => (
              <li key={f.id}>
                <button className="list-row" onClick={() => f.target && select(f.target)}>
                  <i className={`sev ${f.severity}`} />
                  <span className="grow">
                    <div className="title">{f.title}</div>
                    <div className="meta">{f.detail}</div>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
      <IntelPanel repo={name} />
    </>
  );
}
