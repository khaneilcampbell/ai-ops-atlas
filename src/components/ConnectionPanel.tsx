import { Icon } from "./Icon";
import { CONNECTION_HEALTH_LABEL, CONNECTION_LABEL, CONNECTION_STATUS_LABEL, LINK_COLORS, type Connection, type Endpoint } from "../lib/connections";
import { formatDate, relative } from "../lib/time";
import { useAtlas } from "../state";

const NA = <span className="muted">Not available</span>;

const KIND: Record<string, string> = {
  repo: "The repository holds this agent's code or workflow",
  dep: "Agent dependency from the agent registry",
  decl: "Connection declared in the project manifest",
  sync: "Repository data that AI Ops Atlas reads from GitHub",
};

/** The connection inspector, docked beside the map in place of the building inspector. */
export function ConnectionPanel({ c, onClose }: { c: Connection; onClose: () => void }) {
  const { catalog, select } = useAtlas();
  const name = (e: Endpoint) => (e.kind === "agent" ? catalog.agents.find((a) => a.id === e.id)?.name : catalog.projects.find((p) => p.id === e.id)?.name) ?? e.id;
  const open = (e: Endpoint) => {
    if (e.kind === "agent") return select({ kind: "agent", id: e.id });
    const p = catalog.projects.find((x) => x.id === e.id);
    if (p) select({ kind: "repo", id: p.repository });
  };
  const end = (e: Endpoint) => (
    <button className="text-btn" style={{ padding: 0, textAlign: "left" }} onClick={() => open(e)}>
      {name(e)}
      <span className="muted small"> · {e.kind === "agent" ? "agent" : "project"}</span>
    </button>
  );
  const list = (xs: string[]) => (xs.length ? xs.map((x) => <div key={x}>{x}</div>) : NA);

  return (
    <aside className="panel docked" aria-label="Connection inspector">
      <div className="panel-head">
        <div className="grow">
          <div className="eyebrow">Connection · {CONNECTION_LABEL[c.type]}</div>
          <h2>
            {name(c.source)} {c.directed ? "→" : "↔"} {name(c.target)}
          </h2>
          <div className="chips" style={{ marginTop: 10 }}>
            <span className="chip">{CONNECTION_LABEL[c.type]}</span>
            <span className={`chip link-${c.status}`}>
              <i className="swatch" style={{ background: LINK_COLORS[c.status].day }} />
              {CONNECTION_HEALTH_LABEL[c.status]}
            </span>
            {!c.directed && <span className="chip">Two-way</span>}
          </div>
        </div>
        <button className="icon-btn" onClick={onClose} aria-label="Close connection" style={{ color: "var(--ink-2)" }}>
          <Icon name="close" />
        </button>
      </div>
      <div className="panel-body selectable">
        <p style={{ margin: 0, fontSize: 14 }}>{c.relation}.</p>
        <dl className="kv">
          <dt>From</dt>
          <dd>{end(c.source)}</dd>
          <dt>To</dt>
          <dd>{end(c.target)}</dd>
          <dt>Relationship</dt>
          <dd>
            {KIND[c.id.split(":")[0]]}
            <div className="muted small">{c.directed ? `Direction: ${name(c.source)} → ${name(c.target)}` : "Direction: both ways, or not stated"}</div>
          </dd>
          <dt>Repositories</dt>
          <dd>
            {c.repositories.length
              ? c.repositories.map((r) => (
                  <div key={r}>
                    <button className="text-btn mono" style={{ padding: 0, textAlign: "left" }} onClick={() => select({ kind: "repo", id: r })}>
                      {r}
                    </button>
                  </div>
                ))
              : NA}
          </dd>
          <dt>AI agents</dt>
          <dd>{list(c.agents)}</dd>
          <dt>n8n workflows</dt>
          <dd>{list(c.workflows.filter((w) => w.startsWith("n8n")))}</dd>
          <dt>Details</dt>
          <dd>{list([...c.workflows.filter((w) => !w.startsWith("n8n")), ...c.details])}</dd>
          <dt>Last verified activity</dt>
          <dd>{c.lastVerified ? `${formatDate(c.lastVerified)} (${relative(c.lastVerified)})` : NA}</dd>
          <dt>Status</dt>
          <dd>
            {c.status === "unknown" ? NA : CONNECTION_STATUS_LABEL[c.status]}
            <div className="muted small">{c.statusNote}</div>
          </dd>
        </dl>
        <div>
          <div className="section-title">Evidence</div>
          <ul className="evidence">
            {c.evidence.map((e) => (
              <li key={e} className="small">
                {e}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </aside>
  );
}
