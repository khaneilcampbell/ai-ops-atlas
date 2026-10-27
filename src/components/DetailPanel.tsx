import { useEffect, useMemo, useState } from "react";
import { Icon } from "./Icon";
import { ExternalLink, HealthBadge, Indicator, LANG_COLORS, StatusPill } from "./bits";
import { activityFeed, effectiveLastRun, latestPerWorkflow, observedRun, overallHealth, repoData, repoHealth, type Health } from "../lib/derive";
import { frameworkColor } from "../views/mapLayout";
import { formatDate, relative } from "../lib/time";
import { useAtlas } from "../state";
import type { Agent } from "../catalog/types";

/** Details for the current selection: an overlay on list views, or docked beside the map. */
export function DetailPanel({ docked = false }: { docked?: boolean }) {
  const { selection, select } = useAtlas();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && select(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [select]);

  if (!selection) return null;
  const body = selection.kind === "agent" ? <AgentDetail id={selection.id} /> : <RepoDetail name={selection.id} />;
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
      </Head>
      <div className="panel-body selectable">
        <p style={{ margin: 0, fontSize: 14 }}>{agent.purpose}</p>
        <dl className="kv">
          <dt>Project</dt>
          <dd>{project?.name}</dd>
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
              <dd className="mono">{agent.source}</dd>
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

function RepoDetail({ name }: { name: string }) {
  const { catalog, repos, select, setView, setFilters, clearFilters } = useAtlas();
  const [more, setMore] = useState(false);
  const state = repos[name];
  const snap = repoData(state);
  const project = catalog.projects.find((p) => p.repository === name);
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
      <Head eyebrow={project ? "Project" : "Repository · Not in the catalog yet"} title={project?.name ?? name.split("/")[1]}>
        <div className="mono muted" style={{ marginTop: 4 }}>
          {name}
        </div>
        <div className="chips" style={{ marginTop: 10 }}>
          {project && <StatusPill status={project.status} />}
          <HealthBadge health={snap ? overallHealth(indicators) : "unknown"} />
          {snap && <span className="chip">{snap.visibility}</span>}
          {snap?.archived && <span className="chip">Archived</span>}
        </div>
      </Head>
      <div className="panel-body selectable">
        {state?.kind === "error" && (
          <div className="notice">
            <Icon name="alert" size={15} /> {state.message}
          </div>
        )}
        {(snap?.description ?? project?.summary) && <p style={{ margin: 0, fontSize: 14 }}>{snap?.description ?? project?.summary}</p>}

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

        <section>
          <div className="section-head">
            <div className="section-title">Agents ({agents.length})</div>
            <span className="source">Declared in the manifest</span>
          </div>
          {agents.length === 0 ? (
            <div className="muted small">{project ? "No agents are registered for this project." : "Add a manifest in catalog/ to register this repository's agents."}</div>
          ) : (
            <ul className="list" style={{ padding: 0 }}>
              {agents.map((a) => (
                <li key={a.id}>
                  <button className="list-row" onClick={() => select({ kind: "agent", id: a.id })}>
                    <i className="roof" style={{ background: a.status === "attention" ? "var(--gold)" : frameworkColor(a.framework) }} />
                    <span className="grow">
                      <div className="title">{a.name}</div>
                      <div className="meta">
                        {a.framework}
                        {a.trigger ? ` · ${a.trigger}` : ""}
                      </div>
                    </span>
                    <StatusPill status={a.status} />
                  </button>
                </li>
              ))}
            </ul>
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
      </div>
    </>
  );
}
