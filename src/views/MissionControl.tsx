import { useMemo } from "react";
import { Icon } from "../components/Icon";
import { ExternalLink } from "../components/bits";
import { RerunButton } from "../components/RerunButton";
import { ApprovalQueue } from "../components/ApprovalQueue";
import { useActions } from "../actions/state";
import { useProposals } from "../approvals/state";
import { activityFeed, type AttentionItem } from "../lib/derive";
import { workspaceMetrics, type DayBucket } from "../lib/metrics";
import { relative } from "../lib/time";
import { useAtlas } from "../state";
import { useIntel } from "../intel/state";
import { rollup, usd } from "../intel/format";

const WINDOW = 14;

/** The analytics layout: one click from the map, counted only from manifests and GitHub. */
export function MissionControl({ attention }: { attention: AttentionItem[] }) {
  const { catalog, repos, uncataloged, usage, select, setView, setFilters, clearFilters } = useAtlas();
  const intel = useIntel();
  const actionsAvailable = useActions().available;
  const pendingCount = useProposals().length;
  const intelRuns = intel.status?.runs;
  const spend = useMemo(() => (intelRuns ? rollup(intelRuns) : null), [intelRuns]);
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
        <Tile label="Projects" value={m.projects} sub={`${m.repos} repositories · ${m.synced} synced`} source="Catalog manifests" onClick={() => setView("grid")} />
        <Tile
          label="Configured agents"
          value={m.agents}
          sub={`${m.agentsByStatus.active} active · ${m.frameworks} frameworks · ${m.observedAgents} watched via Actions`}
          source="Catalog manifests"
          onClick={() => toAgents()}
        />
        <Tile
          label={`Workflow runs · last ${WINDOW} days`}
          value={m.runs.total}
          sub={m.runs.successRate === null ? "No finished runs in the window" : `${Math.round(m.runs.successRate * 100)}% succeeded · ${m.runs.failure} failed ${m.runs.failure === 1 ? "run" : "runs"} in the window`}
          source="GitHub · latest 10 default-branch runs per repository"
        />
        <Tile label={`Commits · last ${WINDOW} days`} value={m.commits} sub={`Across ${m.busiest.filter((b) => b.commits).length} repositories`} source="GitHub · latest 10 default-branch commits per repository" />
        <Tile
          label="Workflows failing now"
          value={m.failing.length}
          sub={
            m.failing.length
              ? "Their most recent default-branch run failed, whenever it ran"
              : !m.synced
                ? "Not verified until GitHub is synced"
                : m.synced < m.repos
                  ? `None in the ${m.synced} synced repositories; the rest are not verified`
                  : "Every workflow's most recent default-branch run passed"
          }
          source={`GitHub · latest run of each workflow, any age · ${m.synced} of ${m.repos} repositories synced`}
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
          <div className="card-foot muted small">
            Last {WINDOW} days, from each repository's latest 10 runs on its default branch; older runs are not fetched. Red bars are failed runs, including ones a later run fixed, so they can differ from the workflows failing now.
          </div>
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
                <div className="title">Model API spend this month</div>
                <div className="meta">
                  {intel.status
                    ? `Repository intelligence · ${spend?.runsWithCost ?? 0} priced runs · estimated from reported tokens`
                    : "Appears once repository intelligence has run in the desktop app."}
                </div>
              </div>
              {intel.status ? (
                <button className="api-num text-btn" onClick={() => setView("intel")} title="Open Intel">
                  {usd(intel.status.month_spent_usd, 2)}
                  {intel.status.config.monthly_budget_usd > 0 && <span className="muted"> / {usd(intel.status.config.monthly_budget_usd, 0)}</span>}
                </button>
              ) : (
                <span className="na">Not available</span>
              )}
            </div>
            {intel.status && intel.status.config.monthly_budget_usd > 0 && (
              <div
                className="meter"
                role="img"
                aria-label={`${usd(intel.status.month_spent_usd, 2)} of ${usd(intel.status.config.monthly_budget_usd, 0)} monthly model budget used`}
              >
                <i style={{ width: `${Math.min(100, Math.round((intel.status.month_spent_usd / intel.status.config.monthly_budget_usd) * 100))}%`, background: "var(--gold)" }} />
              </div>
            )}
          </div>
        </section>
      </div>

      {actionsAvailable && (
        <section className="card mc-approvals">
          <div className="card-head">
            <h2 className="grow">Awaiting your approval</h2>
            <span className="muted small" title="Actions agents propose from verified GitHub data. Each one asks again in a native dialog and is logged.">
              {pendingCount} proposed
            </span>
          </div>
          <ApprovalQueue />
        </section>
      )}

      <div className="grid mc-row">
        <section className="card">
          <div className="card-head">
            <h2 className="grow">Workflows failing now</h2>
            <span className="muted small" title="A workflow is failing now when its most recent run on the default branch failed. Failed runs that were later fixed are counted only in the runs chart.">
              {m.failing.length} · latest run failed
            </span>
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
                    <RerunButton repo={f.repo} run={f.run} />
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

function Tile({ label, value, sub, source, tone, onClick }: { label: string; value: number; sub: string; source: string; tone?: "accent" | "bad"; onClick?: () => void }) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag className={`card tile ${tone ?? ""}`} onClick={onClick} style={{ textAlign: "left" }}>
      <div className="eyebrow">{label}</div>
      <div className="num">{value.toLocaleString()}</div>
      <div className="sub">{sub}</div>
      <div className="src">{source}</div>
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
