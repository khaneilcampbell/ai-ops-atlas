import { useMemo, useRef, useState } from "react";
import { STATUSES, type Agent } from "../catalog/types";
import { FilterBar, uniqueOptions } from "../components/Filters";
import { Icon } from "../components/Icon";
import { ExternalLink, StatusPill, statusLabel } from "../components/bits";
import { runResult } from "../lib/activity";
import { attentionItems, effectiveLastRun, observedRun, repoData } from "../lib/derive";
import { agentMatches } from "../lib/search";
import { formatDate, relative } from "../lib/time";
import { useAtlas } from "../state";
import { frameworkColor } from "./mapLayout";

type Tab = "config" | "capabilities" | "executions" | "monitoring";
const TABS: { id: Tab; label: string }[] = [
  { id: "config", label: "Configuration" },
  { id: "capabilities", label: "Capabilities" },
  { id: "executions", label: "Executions" },
  { id: "monitoring", label: "Monitoring" },
];

/** Agent management: every manifest agent, with its configuration, access and run history. Read-only. */
export function AgentsView() {
  const { catalog, repos, filters, select, selection } = useAtlas();
  const projectName = (id: string) => catalog.projects.find((p) => p.id === id)?.name ?? id;
  const list = useRef<HTMLUListElement>(null);

  const rows = useMemo(
    () =>
      catalog.agents.filter(
        (a) =>
          (!filters.project || a.projectId === filters.project) &&
          (!filters.framework || a.framework === filters.framework) &&
          (!filters.status || a.status === filters.status) &&
          (!filters.language || repoData(repos[a.repository])?.language === filters.language) &&
          agentMatches(a, catalog.projects.find((p) => p.id === a.projectId), filters.query),
      ),
    [catalog, repos, filters],
  );
  const current = (selection?.kind === "agent" && rows.find((a) => a.id === selection.id)) || rows[0];
  const byStatus = STATUSES.map((s) => ({ s, n: catalog.agents.filter((a) => a.status === s).length })).filter((x) => x.n);

  const onListKey = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const i = rows.findIndex((a) => a.id === current?.id);
    const next = rows[Math.max(0, Math.min(rows.length - 1, i + (e.key === "ArrowDown" ? 1 : -1)))];
    if (!next) return;
    select({ kind: "agent", id: next.id });
    list.current?.querySelector<HTMLButtonElement>(`[data-id="${next.id}"]`)?.focus();
  };

  return (
    <div className="page wide">
      <div className="page-head">
        <div className="grow">
          <div className="eyebrow">Agent management · read-only</div>
          <h1>Agents</h1>
          <p className="lede">
            {catalog.agents.length} agents registered in project manifests.{" "}
            {byStatus.map((x, i) => (
              <span key={x.s}>
                {i > 0 && " · "}
                {x.n} {statusLabel(x.s).toLowerCase()}
              </span>
            ))}
          </p>
        </div>
      </div>
      <FilterBar
        noun="agents"
        count={rows.length}
        defs={[
          { key: "project", label: "Project", options: catalog.projects.map((p) => ({ value: p.id, label: p.name })) },
          { key: "framework", label: "Framework", options: uniqueOptions(catalog.agents.map((a) => a.framework)) },
          { key: "status", label: "Status", options: STATUSES.map((s) => ({ value: s, label: statusLabel(s) })) },
          { key: "language", label: "Language", options: uniqueOptions(Object.values(repos).map((r) => repoData(r)?.language)) },
        ]}
      />
      {rows.length === 0 ? (
        <div className="card empty">No agents match these filters.</div>
      ) : (
        <div className="agents-split">
          <ul className="card agent-list" ref={list} onKeyDown={onListKey} aria-label="Agents">
            {rows.map((a) => {
              const last = effectiveLastRun(a, repoData(repos[a.repository]));
              const on = a.id === current?.id;
              return (
                <li key={a.id}>
                  <button data-id={a.id} className={`agent-row ${on ? "on" : ""}`} aria-current={on || undefined} onClick={() => select({ kind: "agent", id: a.id })}>
                    <i className="roof" style={{ background: a.status === "attention" ? "var(--gold)" : frameworkColor(a.framework) }} />
                    <span className="grow">
                      <span className="title">{a.name}</span>
                      <span className="meta">
                        {projectName(a.projectId)} · {a.framework}
                      </span>
                    </span>
                    <span className="right">
                      <StatusPill status={a.status} />
                      <span className="muted small" title={last ? formatDate(last) : undefined}>
                        {last ? relative(last) : "No run recorded"}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          {current && <AgentProfile key={current.id} agent={current} />}
        </div>
      )}
    </div>
  );
}

function AgentProfile({ agent }: { agent: Agent }) {
  const { catalog, repos, manifestIssues, uncataloged, select } = useAtlas();
  const [tab, setTab] = useState<Tab>("config");
  const project = catalog.projects.find((p) => p.id === agent.projectId);
  const snap = repoData(repos[agent.repository]);
  const last = effectiveLastRun(agent, snap);
  const run = observedRun(agent, snap);
  const wf = agent.observe?.githubWorkflow;
  const runs = (wf && snap?.workflowRuns[wf]) || [];
  const branch = snap?.defaultBranch ?? "HEAD";
  const source = agent.source ? `https://github.com/${agent.repository}/blob/${branch}/${agent.source}` : undefined;
  const flags = useMemo(
    () => attentionItems(catalog, repos, manifestIssues, Date.now(), uncataloged).filter((i) => i.target?.kind === "agent" && i.target.id === agent.id),
    [catalog, repos, manifestIssues, uncataloged, agent.id],
  );

  const onTabKey = (e: React.KeyboardEvent) => {
    const i = TABS.findIndex((t) => t.id === tab);
    const d = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const next = TABS[(i + d + TABS.length) % TABS.length];
    setTab(next.id);
    document.getElementById(`agent-tab-${next.id}`)?.focus();
  };

  return (
    <section className="card agent-profile" aria-label={agent.name}>
      <header className="ap-head">
        <span className="ap-badge" style={{ background: frameworkColor(agent.framework) }}>
          <Icon name="agents" size={20} />
        </span>
        <div className="grow">
          <div className="eyebrow">
            {project?.name ?? agent.projectId} · {agent.repository}
          </div>
          <h2>{agent.name}</h2>
          <div className="chips" style={{ marginTop: 8 }}>
            <StatusPill status={agent.status} />
            <span className="chip">
              <i className="swatch" style={{ background: frameworkColor(agent.framework) }} />
              {agent.framework}
            </span>
            {agent.model && <span className="chip">{agent.model}</span>}
            <span className="chip">{wf ? `Watched via ${wf}` : "Manifest only"}</span>
          </div>
        </div>
        <div className="ap-last">
          <div className="eyebrow">Last run</div>
          <div className="v">{last ? relative(last) : "Not recorded"}</div>
          <div className="muted small">{run ? `GitHub Actions: ${run.conclusion ?? run.status}` : last ? "From the manifest" : "No live source"}</div>
        </div>
      </header>
      <p className="ap-purpose selectable">{agent.purpose}</p>

      <div className="tabs" role="tablist" aria-label="Agent details" onKeyDown={onTabKey}>
        {TABS.map((t) => (
          <button
            key={t.id}
            id={`agent-tab-${t.id}`}
            role="tab"
            aria-selected={tab === t.id}
            aria-controls={`agent-panel-${t.id}`}
            tabIndex={tab === t.id ? 0 : -1}
            className={tab === t.id ? "on" : ""}
            onClick={() => setTab(t.id)}
          >
            {t.label}
            {t.id === "executions" && runs.length > 0 && <span className="count-pill">{runs.length}</span>}
            {t.id === "monitoring" && flags.length > 0 && <span className="count-pill warn">{flags.length}</span>}
          </button>
        ))}
      </div>

      <div className="ap-body selectable" role="tabpanel" id={`agent-panel-${tab}`} aria-labelledby={`agent-tab-${tab}`}>
        {tab === "config" && (
          <>
            <dl className="kv">
              <dt>Framework</dt>
              <dd>{agent.framework}</dd>
              <dt>Model</dt>
              <dd>{agent.model ?? <span className="muted">Not declared</span>}</dd>
              <dt>Runtime</dt>
              <dd>{agent.runtime ?? <span className="muted">Not declared</span>}</dd>
              <dt>Trigger</dt>
              <dd>{agent.trigger ?? <span className="muted">Not declared</span>}</dd>
              <dt>Source</dt>
              <dd className="mono">{source ? <ExternalLink href={source}>{agent.source}</ExternalLink> : <span className="muted">Not declared</span>}</dd>
              <dt>Repository</dt>
              <dd>
                <button className="text-btn inline" onClick={() => select({ kind: "repo", id: agent.repository })}>
                  {agent.repository}
                </button>
              </dd>
              <dt>Live source</dt>
              <dd>{wf ? <span className="mono">{wf}</span> : <span className="muted">None declared</span>}</dd>
              <dt>Agent id</dt>
              <dd className="mono">{agent.id}</dd>
            </dl>
            {agent.links.length > 0 && (
              <div className="links" style={{ marginTop: 16 }}>
                {agent.links.map((l) => (
                  <ExternalLink key={l.url} href={l.url}>
                    <Icon name="external" size={14} /> {l.label}
                  </ExternalLink>
                ))}
              </div>
            )}
          </>
        )}

        {tab === "capabilities" && (
          <div className="cap-grid">
            <Declared title="Capabilities" items={agent.capabilities} hint="capabilities" example="- Score niches by demand and competition" />
            <Declared title="Permissions" items={agent.permissions} hint="permissions" example={'- "Shopify Admin API: write products"'} />
          </div>
        )}

        {tab === "executions" && (
          <>
            {runs.length > 0 ? (
              <table className="table runs-table">
                <thead>
                  <tr>
                    <th>Result</th>
                    <th>Run</th>
                    <th>Trigger</th>
                    <th>Started</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map((r) => {
                    const res = runResult(r);
                    return (
                      <tr key={r.url}>
                        <td>
                          <span className={`result r-${res}`}>{res === "success" ? "Succeeded" : res === "failure" ? "Failed" : res === "running" ? "Running" : (r.conclusion ?? r.status)}</span>
                        </td>
                        <td>
                          <ExternalLink href={r.url}>{r.name}</ExternalLink>
                        </td>
                        <td className="small">
                          {r.event} on <span className="mono">{r.branch}</span>
                        </td>
                        <td className="small nowrap" title={new Date(r.createdAt).toLocaleString()}>
                          {relative(r.createdAt)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : (
              <div className="na-block">
                <strong>No execution history available.</strong>
                <span>
                  {wf
                    ? "GitHub has not returned runs for this workflow yet. Refresh, or add a token if the repository is private."
                    : `${agent.framework} runs are not reported to Atlas yet. Declare observe.github_workflow in the manifest if a workflow runs this agent; n8n and CrewAI adapters come later.`}
                </span>
              </div>
            )}
            {agent.history.length > 0 && (
              <div style={{ marginTop: 18 }}>
                <div className="section-title">Recorded in the manifest</div>
                <ul className="timeline">
                  {agent.history.map((h) => (
                    <li key={`${h.at}:${h.event}`} className="k-agent">
                      <div className="small">{h.event}</div>
                      <div className="muted small">{formatDate(h.at)}</div>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}

        {tab === "monitoring" && (
          <>
            <div className="mon-grid">
              <Monitor label="Live source" value={wf ? "GitHub Actions" : "None"} sub={wf ? wf : "Status and runs come from the manifest"} health={wf ? "good" : "unknown"} />
              <Monitor
                label="Latest run"
                value={run ? (run.conclusion ?? run.status) : "Not available"}
                sub={run ? relative(run.createdAt) : "No observed runs"}
                health={!run ? "unknown" : runResult(run) === "failure" ? "bad" : runResult(run) === "success" ? "good" : "warn"}
              />
              <Monitor label="Repository sync" value={snap ? relative(snap.fetchedAt) : "Not synced"} sub={agent.repository} health={snap ? "good" : "unknown"} />
            </div>
            <div className="section-title" style={{ marginTop: 18 }}>
              Checks
            </div>
            {flags.length === 0 ? (
              <div className="muted small">Nothing flagged for this agent.</div>
            ) : (
              <ul className="list" style={{ padding: 0 }}>
                {flags.map((f) => (
                  <li key={f.id} className="list-row">
                    <span className={`sev ${f.severity}`} aria-label={`${f.severity} severity`} />
                    <span className="grow">
                      <div className="title">{f.detail}</div>
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <p className="muted small" style={{ marginTop: 14 }}>
              Atlas only reads. It cannot start, stop or reconfigure agents.
            </p>
          </>
        )}
      </div>
    </section>
  );
}

function Declared({ title, items, hint, example }: { title: string; items?: string[]; hint: string; example: string }) {
  return (
    <div>
      <div className="section-title">{title}</div>
      {items && items.length ? (
        <ul className="declared">
          {items.map((c) => (
            <li key={c}>
              <Icon name="check" size={13} /> {c}
            </li>
          ))}
        </ul>
      ) : (
        <div className="na-block">
          <strong>Not declared in the manifest.</strong>
          <span>
            Add a <code>{hint}</code> list to this agent, for example:
          </span>
          <pre>
            {hint}:{"\n  "}
            {example}
          </pre>
        </div>
      )}
    </div>
  );
}

function Monitor({ label, value, sub, health }: { label: string; value: string; sub: string; health: "good" | "warn" | "bad" | "unknown" }) {
  return (
    <div className="mon">
      <div className="eyebrow">{label}</div>
      <div className="v">
        <i className={`h-${health}`} /> {value}
      </div>
      <div className="muted small">{sub}</div>
    </div>
  );
}
