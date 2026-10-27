import { useEffect, useMemo } from "react";
import { Icon } from "./Icon";
import { ExternalLink, Indicator, LangDot, StatusPill } from "./bits";
import { activityFeed, effectiveLastRun, observedRun, repoData, repoHealth } from "../lib/derive";
import { formatDate, relative } from "../lib/time";
import { useAtlas } from "../state";
import type { Agent } from "../catalog/types";
import { IntelPanel } from "./IntelPanel";

export function DetailPanel() {
  const { selection, select } = useAtlas();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && select(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [select]);

  if (!selection) return null;
  return (
    <>
      <div className="scrim" onClick={() => select(null)} />
      <aside className="panel" role="dialog" aria-label="Details">
        {selection.kind === "agent" ? <AgentDetail id={selection.id} /> : <RepoDetail name={selection.id} />}
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

function RepoDetail({ name }: { name: string }) {
  const { catalog, repos, select } = useAtlas();
  const state = repos[name];
  const snap = repoData(state);
  const project = catalog.projects.find((p) => p.repository === name);
  const agents = catalog.agents.filter((a) => a.repository === name);
  const history = useMemo(() => activityFeed(catalog, repos, { repo: name }), [catalog, repos, name]);
  const languages = snap ? Object.entries(snap.languages) : [];
  const total = languages.reduce((s, [, v]) => s + v, 0);

  return (
    <>
      <Head eyebrow={`Repository · ${project?.name ?? "Not in the catalog yet"}`} title={name.split("/")[1]}>
        <div className="muted small" style={{ marginTop: 4 }}>
          {name}
        </div>
      </Head>
      <div className="panel-body selectable">
        {state?.kind === "error" && (
          <div className="notice">
            <Icon name="alert" size={15} /> {state.message}
          </div>
        )}
        <p style={{ margin: 0, fontSize: 14 }}>{snap?.description ?? project?.summary}</p>
        <div className="chips">
          {repoHealth(snap, agents.length).map((i) => (
            <span key={i.key} className="chip">
              <Indicator ind={i} />
            </span>
          ))}
        </div>
        <dl className="kv">
          <dt>Language</dt>
          <dd>
            <LangDot lang={snap?.language ?? null} />
            {total > 0 && (
              <div className="muted small">
                {languages
                  .slice(0, 4)
                  .map(([l, v]) => `${l} ${Math.round((v / total) * 100)}%`)
                  .join(" · ")}
              </div>
            )}
          </dd>
          <dt>Default branch</dt>
          <dd className="mono">{snap?.defaultBranch ?? "–"}</dd>
          <dt>Last push</dt>
          <dd>{snap?.pushedAt ? `${formatDate(snap.pushedAt)} (${relative(snap.pushedAt)})` : "–"}</dd>
          <dt>Visibility</dt>
          <dd>{snap?.visibility ?? "–"}</dd>
          <dt>Synced</dt>
          <dd>{snap ? relative(snap.fetchedAt) : "Not yet"}</dd>
        </dl>
        <IntelPanel repo={name} />
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
          </div>
        </div>
        <div>
          <div className="section-title">Linked agents ({agents.length})</div>
          <ul className="list" style={{ padding: 0 }}>
            {agents.map((a) => (
              <li key={a.id}>
                <button className="list-row" onClick={() => select({ kind: "agent", id: a.id })}>
                  <span className="grow">
                    <div className="title">{a.name}</div>
                    <div className="meta">{a.framework}</div>
                  </span>
                  <StatusPill status={a.status} />
                </button>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <div className="section-title">Activity history</div>
          {history.length === 0 ? (
            <div className="muted small">No activity loaded yet.</div>
          ) : (
            <ul className="timeline">
              {history.slice(0, 20).map((h) => (
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
