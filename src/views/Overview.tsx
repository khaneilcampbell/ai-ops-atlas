import { useMemo } from "react";
import { Icon } from "../components/Icon";
import { HealthDot, StatusPill } from "../components/bits";
import { activityFeed, overallHealth, repoData, repoHealth, type AttentionItem } from "../lib/derive";
import { relative } from "../lib/time";
import { useAtlas } from "../state";

export function Overview({ attention }: { attention: AttentionItem[] }) {
  const { catalog, repos, uncataloged, select, setView, setFilters, clearFilters } = useAtlas();
  const activity = useMemo(() => activityFeed(catalog, repos).slice(0, 12), [catalog, repos]);
  const active = catalog.agents.filter((a) => a.status === "active").length;
  const frameworks = new Set(catalog.agents.map((a) => a.framework)).size;
  const repoCount = new Set(catalog.projects.map((p) => p.repository)).size + uncataloged.length;
  const loaded = Object.values(repos).filter((r) => r.kind === "ok").length;

  return (
    <div className="page">
      <div className="page-head">
        <div className="grow">
          <div className="eyebrow">Your workspace, in motion</div>
          <h1>Welcome back to the atlas.</h1>
          <p className="lede">
            {catalog.projects.length} projects. {catalog.agents.length} agents. {repoCount} repositories. One connected portfolio.
          </p>
        </div>
        <button className="ghost-btn dark" onClick={() => setView("map")}>
          <Icon name="map" size={16} /> Open the map
        </button>
      </div>

      <div className="grid tiles" style={{ marginBottom: 16 }}>
        <Tile label="Agents" value={catalog.agents.length} sub={`${frameworks} frameworks`} onClick={() => { clearFilters(); setView("agents"); }} />
        <Tile label="Active agents" value={active} sub={`${catalog.agents.length - active} idle, paused or retired`} onClick={() => { clearFilters(); setFilters({ status: "active" }); setView("agents"); }} />
        <Tile label="Repositories" value={repoCount} sub={uncataloged.length ? `${loaded} synced · ${uncataloged.length} not in the catalog` : `${loaded} synced from GitHub`} onClick={() => { clearFilters(); setView("repos"); }} />
        <Tile label="Needs attention" value={attention.length} sub={attention.length ? "See the list below" : "All clear"} accent />
      </div>

      <div className="grid two" style={{ marginBottom: 16 }}>
        <section className="card">
          <div className="card-head">
            <h2 className="grow">Needs attention</h2>
            <span className="muted small">{attention.length} items</span>
          </div>
          {attention.length === 0 ? (
            <div className="empty">Nothing needs you right now.</div>
          ) : (
            <ul className="list">
              {attention.map((a) => (
                <li key={a.id}>
                  <button className="list-row" onClick={() => a.target && select(a.target)} disabled={!a.target}>
                    <span className={`sev ${a.severity}`} aria-label={`${a.severity} severity`} />
                    <span className="grow">
                      <div className="title">{a.title}</div>
                      <div className="meta">{a.detail}</div>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card">
          <div className="card-head">
            <h2 className="grow">Recent activity</h2>
            <span className="muted small">Commits, CI runs and agent history</span>
          </div>
          {activity.length === 0 ? (
            <div className="empty">No activity yet. Refresh to load GitHub data.</div>
          ) : (
            <ul className="list">
              {activity.map((a) => (
                <li key={a.id}>
                  <button className="list-row" onClick={() => a.target && select(a.target)}>
                    <span className="kind-icon">
                      <Icon name={a.kind === "commit" ? "commit" : a.kind === "run" ? "play" : "agents"} size={13} />
                    </span>
                    <span className="grow">
                      <div className="title">{a.title}</div>
                      <div className="meta">{a.subtitle}</div>
                    </span>
                    <span className="muted small" style={{ whiteSpace: "nowrap" }}>
                      {relative(a.at)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <div className="page-head" style={{ marginTop: 28, marginBottom: 12 }}>
        <h2 className="grow">Projects</h2>
      </div>
      <div className="grid three">
        {catalog.projects.map((p) => {
          const agents = catalog.agents.filter((a) => a.projectId === p.id);
          const snap = repoData(repos[p.repository]);
          const health = overallHealth(repoHealth(snap, agents.length));
          return (
            <article key={p.id} className="card project-card">
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <StatusPill status={p.status} />
                <span className="grow" />
                <HealthDot health={health} label={health === "good" ? "Healthy" : health === "warn" ? "Check" : health === "bad" ? "Failing" : "Unknown"} />
              </div>
              <h3>{p.name}</h3>
              <p className="muted small" style={{ margin: 0 }}>
                {p.summary}
              </p>
              <button className="chip" onClick={() => select({ kind: "repo", id: p.repository })}>
                <Icon name="repos" size={12} /> {p.repository.split("/")[1]}
                {snap?.pushedAt && <span className="muted">· pushed {relative(snap.pushedAt)}</span>}
              </button>
              <div>
                <div className="section-title">{agents.length} agents</div>
                <div className="agents">
                  {agents.map((a) => (
                    <button key={a.id} className="chip" onClick={() => select({ kind: "agent", id: a.id })} title={a.purpose}>
                      <span className={`status ${a.status}`} style={{ padding: 0, background: "none", border: 0 }} />
                      {a.name}
                    </button>
                  ))}
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}

function Tile({ label, value, sub, accent, onClick }: { label: string; value: number; sub: string; accent?: boolean; onClick?: () => void }) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag className={`card tile ${accent ? "accent" : ""}`} onClick={onClick} style={{ textAlign: "left", border: onClick ? undefined : undefined }}>
      <div className="eyebrow">{label}</div>
      <div className="num">{value}</div>
      <div className="sub">{sub}</div>
    </Tag>
  );
}
