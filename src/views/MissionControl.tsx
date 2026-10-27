import { useMemo } from "react";
import { Icon } from "../components/Icon";
import { ExternalLink } from "../components/bits";
import { activityFeed, type AttentionItem } from "../lib/derive";
import { workspaceMetrics, type DayBucket } from "../lib/metrics";
import { relative } from "../lib/time";
import { useAtlas } from "../state";

const WINDOW = 14;

/** The analytics layout: one click from the map, counted only from manifests and GitHub. */
export function MissionControl({ attention }: { attention: AttentionItem[] }) {
  const { catalog, repos, uncataloged, usage, select, setView, setFilters, clearFilters } = useAtlas();
  const m = useMemo(() => workspaceMetrics(catalog, repos, uncataloged, Date.now(), WINDOW), [catalog, repos, uncataloged]);
  const activity = useMemo(() => activityFeed(catalog, repos).slice(0, 10), [catalog, repos]);
  const toAgents = (status?: string) => {
    clearFilters();
    if (status) setFilters({ status });
    setView("agents");
  };
  const maxBusy = Math.max(1, ...m.busiest.map((b) => b.commits + b.runs));

  return (
    <div className="page mission">
      <div className="page-head">
        <div className="grow">
          <div className="eyebrow">Mission Control</div>
          <h1>Everything in motion, at a glance.</h1>
          <p className="lede">Every number here is counted from your manifests or read from GitHub. Where there is no source yet, it says so.</p>
        </div>
        <button className="ghost-btn dark" onClick={() => setView("map")}>
          <Icon name="map" size={16} /> Back to the map
        </button>
      </div>

      <div className="grid kpis">
        <Tile label="Projects" value={m.projects} sub={`${m.repos} repositories · ${m.synced} synced`} onClick={() => setView("grid")} />
        <Tile
          label="Configured agents"
          value={m.agents}
          sub={`${m.agentsByStatus.active} active · ${m.frameworks} frameworks · ${m.observedAgents} watched via Actions`}
          onClick={() => toAgents()}
        />
        <Tile
          label={`Workflow runs · ${WINDOW} d`}
          value={m.runs.total}
          sub={m.runs.successRate === null ? "No finished runs in the window" : `${Math.round(m.runs.successRate * 100)}% succeeded · ${m.runs.failure} failed`}
        />
        <Tile label={`Commits · ${WINDOW} d`} value={m.commits} sub={`Across ${m.busiest.filter((b) => b.commits).length} repositories`} />
        <Tile
          label="Failing workflows"
          value={m.failing.length}
          sub={m.failing.length ? "Latest run failed" : "Every workflow's latest run passed"}
          tone={m.failing.length ? "bad" : "accent"}
        />
      </div>

      <div className="grid mc-row">
        <section className="card">
          <div className="card-head">
            <h2 className="grow">Workflow runs per day</h2>
            <span className="legend-inline">
              <span><i style={{ background: "var(--good)" }} /> Succeeded</span>
              <span><i style={{ background: "var(--bad)" }} /> Failed</span>
              <span><i style={{ background: "var(--sage-400)" }} /> Other</span>
            </span>
          </div>
          <RunsChart days={m.days} />
          <div className="card-foot muted small">From each repository's latest 10 runs on its default branch. Runs older than that are not fetched.</div>
        </section>

        <section className="card">
          <div className="card-head">
            <h2 className="grow">API usage and cost</h2>
          </div>
          <div className="api-rows">
            <div className="api-row">
              <div className="grow">
                <div className="title">GitHub API</div>
                <div className="meta">{usage?.rate ? `Resets ${relative(new Date(usage.rate.reset * 1000).toISOString()).replace(" ago", "")}` : "Budget appears after the first refresh"}</div>
              </div>
              {usage?.rate ? (
                <div className="api-num">
                  {usage.rate.remaining.toLocaleString()}
                  <span className="muted"> / {usage.rate.limit.toLocaleString()}</span>
                </div>
              ) : (
                <span className="na">Not available</span>
              )}
            </div>
            {usage?.rate && (
              <div className="meter" role="img" aria-label={`${usage.rate.remaining} of ${usage.rate.limit} GitHub requests left this hour`}>
                <i style={{ width: `${Math.round((usage.rate.remaining / Math.max(1, usage.rate.limit)) * 100)}%` }} />
              </div>
            )}
            {usage && (
              <div className="meta small muted">
                Last refresh {relative(usage.at)}: {usage.requests} requests, {usage.counted} counted against the budget
              </div>
            )}
            <div className="api-row">
              <div className="grow">
                <div className="title">Model API spend</div>
                <div className="meta">No cost source is connected yet. Spend appears here once an agent reports its usage to Atlas.</div>
              </div>
              <span className="na">Not available</span>
            </div>
          </div>
        </section>
      </div>

      <div className="grid mc-row">
        <section className="card">
          <div className="card-head">
            <h2 className="grow">Failing workflows</h2>
            <span className="muted small">{m.failing.length}</span>
          </div>
          {m.failing.length === 0 ? (
            <div className="empty">{m.synced ? "No workflow's latest run has failed." : "Refresh to load workflow runs from GitHub."}</div>
          ) : (
            <ul className="list">
              {m.failing.map((f) => (
                <li key={f.run.url}>
                  <div className="list-row">
                    <span className="sev high" aria-hidden />
                    <span className="grow">
                      <div className="title">
                        <ExternalLink href={f.run.url}>{f.run.name}</ExternalLink>
                      </div>
                      <div className="meta">
                        <button className="text-btn inline" onClick={() => select({ kind: "repo", id: f.repo })}>
                          {f.project ?? f.repo}
                        </button>{" "}
                        · {f.run.event} on {f.run.branch}
                      </div>
                    </span>
                    <span className="muted small nowrap" title={new Date(f.run.createdAt).toLocaleString()}>
                      {relative(f.run.createdAt)}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card">
          <div className="card-head">
            <h2 className="grow">Needs attention</h2>
            <span className="muted small">{attention.length}</span>
          </div>
          {attention.length === 0 ? (
            <div className="empty">Nothing needs you right now.</div>
          ) : (
            <ul className="list">
              {attention.slice(0, 8).map((a) => (
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
              {attention.length > 8 && <li className="muted small" style={{ padding: "4px 12px" }}>{attention.length - 8} more</li>}
            </ul>
          )}
        </section>
      </div>

      <div className="grid mc-row">
        <section className="card">
          <div className="card-head">
            <h2 className="grow">Busiest repositories</h2>
            <span className="muted small">Commits and runs · {WINDOW} d</span>
          </div>
          {m.busiest.length === 0 ? (
            <div className="empty">No commits or runs in the last {WINDOW} days.</div>
          ) : (
            <ul className="list">
              {m.busiest.map((b) => (
                <li key={b.repo}>
                  <button className="list-row busy" onClick={() => select({ kind: "repo", id: b.repo })}>
                    <span className="grow">
                      <div className="title">{b.project ?? b.repo.split("/")[1]}</div>
                      <div className="busy-bar" aria-hidden>
                        <i className="c" style={{ width: `${(b.commits / maxBusy) * 100}%` }} />
                        <i className="r" style={{ width: `${(b.runs / maxBusy) * 100}%` }} />
                      </div>
                    </span>
                    <span className="muted small nowrap">
                      {b.commits} commits · {b.runs} runs
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
                    <span className="muted small nowrap" title={new Date(a.at).toLocaleString()}>
                      {relative(a.at)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

function Tile({ label, value, sub, tone, onClick }: { label: string; value: number; sub: string; tone?: "accent" | "bad"; onClick?: () => void }) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag className={`card tile ${tone ?? ""}`} onClick={onClick} style={{ textAlign: "left" }}>
      <div className="eyebrow">{label}</div>
      <div className="num">{value.toLocaleString()}</div>
      <div className="sub">{sub}</div>
    </Tag>
  );
}

function RunsChart({ days }: { days: DayBucket[] }) {
  const W = 640;
  const H = 150;
  const pad = { l: 26, r: 6, t: 8, b: 22 };
  const max = Math.max(4, ...days.map((d) => d.success + d.failure + d.other));
  const step = (W - pad.l - pad.r) / days.length;
  const bw = Math.min(26, step * 0.62);
  const y = (v: number) => pad.t + (H - pad.t - pad.b) * (1 - v / max);
  const ticks = [0, Math.round(max / 2), max];
  const total = days.reduce((s, d) => s + d.success + d.failure + d.other, 0);
  const label = (d: DayBucket) => new Date(`${d.day}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return (
    <svg className="runs-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${total} workflow runs over ${days.length} days`}>
      {ticks.map((t) => (
        <g key={t}>
          <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} className="gridline" />
          <text x={pad.l - 6} y={y(t) + 3} textAnchor="end" className="axis">
            {t}
          </text>
        </g>
      ))}
      {days.map((d, i) => {
        const x = pad.l + i * step + (step - bw) / 2;
        let acc = 0;
        const seg = (v: number, cls: string) => {
          if (!v) return null;
          const top = y(acc + v);
          const h = y(acc) - top;
          acc += v;
          return <rect key={cls} x={x} y={top} width={bw} height={Math.max(1, h - 1)} rx={2} className={cls} />;
        };
        return (
          <g key={d.day}>
            <title>{`${label(d)}: ${d.success} succeeded, ${d.failure} failed, ${d.other} other, ${d.commits} commits`}</title>
            <rect x={pad.l + i * step} y={pad.t} width={step} height={H - pad.t - pad.b} fill="transparent" />
            {seg(d.success, "ok")}
            {seg(d.failure, "fail")}
            {seg(d.other, "other")}
            {(i % 2 === days.length % 2 || days.length <= 7) && (
              <text x={x + bw / 2} y={H - 6} textAnchor="middle" className="axis">
                {label(d)}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
