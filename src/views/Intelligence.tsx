import { useMemo, useState } from "react";
import { Icon } from "../components/Icon";
import { useAtlas } from "../state";
import { useIntel } from "../intel/state";
import { RUN_LABEL, duration, isActive, lastRuns, rollup, runTone, scheduleLabel, tokens, usd } from "../intel/format";
import { formatDate, relative } from "../lib/time";
import type { AgentStatus, Run } from "../intel/types";

const TABS = [
  { id: "inspector", label: "Agent inspector" },
  { id: "activity", label: "Activity" },
  { id: "costs", label: "Costs" },
] as const;
type Tab = (typeof TABS)[number]["id"];

export function IntelligenceView() {
  const intel = useIntel();
  const [tab, setTab] = useState<Tab>("inspector");

  return (
    <div className="page">
      <div className="page-head">
        <div className="grow">
          <div className="eyebrow">Claude · read-only analysis</div>
          <h1>Repository intelligence</h1>
          <p className="lede">Structured reports on your repositories, grounded in GitHub data. Open a repository and choose Analyze to run it.</p>
        </div>
        <div className="seg" role="tablist">
          {TABS.map((t) => (
            <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? "on" : undefined} onClick={() => setTab(t.id)}>
              {t.label}
            </button>
          ))}
        </div>
      </div>
      {!intel.available ? (
        <div className="card empty">Repository intelligence runs in the desktop app, which keeps the Anthropic key in the Keychain.</div>
      ) : !intel.status ? (
        <div className="card empty">{intel.error ?? "Loading…"}</div>
      ) : tab === "inspector" ? (
        <Inspector status={intel.status} />
      ) : tab === "activity" ? (
        <Activity runs={intel.status.runs} />
      ) : (
        <Costs status={intel.status} />
      )}
    </div>
  );
}

function Inspector({ status }: { status: AgentStatus }) {
  const { select, setView } = useAtlas();
  const { latest, lastSuccess, lastFailure } = lastRuns(status.runs);
  const c = status.config;
  const activeRuns = status.runs.filter(isActive);
  const execState = activeRuns.length ? `${activeRuns.length} running or queued` : latest ? `Idle · last run ${RUN_LABEL[latest.status].toLowerCase()}` : "Idle · never run";
  const retries = status.runs.filter((r) => r.attempts > 1).length;
  return (
    <div className="grid two">
      <section className="card">
        <div className="card-head">
          <h2 className="grow">{status.name}</h2>
          <span className="chip">v{status.version}</span>
        </div>
        <div className="card-pad" style={{ paddingTop: 4 }}>
          <dl className="kv">
            <dt>Execution</dt>
            <dd>
              <span className={`status ${activeRuns.length ? "paused" : latest?.status === "failed" ? "attention" : "idle"}`}>{execState}</span>
            </dd>
            <dt>API key</dt>
            <dd>
              {status.key_present ? (
                "Saved in the Keychain"
              ) : (
                <button className="text-btn" style={{ padding: 0 }} onClick={() => setView("settings")}>
                  Not set · add it in Settings
                </button>
              )}
            </dd>
            <dt>Models</dt>
            <dd>
              <div>Quick: {c.models.quick}</div>
              <div>Standard: {c.models.standard}</div>
              <div>Deep: {c.models.deep}</div>
              <div className="muted small">Default depth: {c.depth}. Safety fallback {c.refusal_fallback ? "on" : "off"}. Prompt version {status.prompt_version}.</div>
            </dd>
            <dt>Limits</dt>
            <dd>
              {usd(c.max_run_usd, 2)} per run · {usd(c.monthly_budget_usd, 2)} per month · {c.max_attempts} attempts · {c.timeout_secs}s timeout
            </dd>
            <dt>Schedule</dt>
            <dd>{c.schedule.enabled ? `${scheduleLabel(c.schedule)}, while the app is open` : "Off (manual runs only)"}</dd>
            <dt>Last success</dt>
            <dd>{lastSuccess ? `${formatDate(lastSuccess.finished_at)} (${relative(lastSuccess.finished_at)}) · ${lastSuccess.repo} · ${duration(lastSuccess.duration_ms)}` : <span className="muted">None yet</span>}</dd>
            <dt>Last error</dt>
            <dd>
              {lastFailure ? (
                <>
                  {lastFailure.error?.message}
                  <div className="muted small">
                    {lastFailure.repo} · {relative(lastFailure.finished_at)} · {lastFailure.attempts} attempt{lastFailure.attempts === 1 ? "" : "s"}
                    {lastFailure.error?.retryable ? " · safe to retry" : ""}
                  </div>
                </>
              ) : (
                <span className="muted">None</span>
              )}
            </dd>
            <dt>Retries</dt>
            <dd>{retries ? `${retries} run${retries === 1 ? "" : "s"} needed more than one attempt` : "None recorded"}</dd>
          </dl>
        </div>
      </section>
      <div className="grid" style={{ gap: 16 }}>
        <section className="card">
          <div className="card-head">
            <h2 className="grow">Assigned repositories</h2>
            <span className="muted small">{c.assigned.length}</span>
          </div>
          {c.assigned.length === 0 ? (
            <div className="empty small">None yet. A repository is assigned the first time you analyze it.</div>
          ) : (
            <ul className="list">
              {c.assigned.map((r) => {
                const last = status.runs.find((x) => x.repo.toLowerCase() === r.toLowerCase());
                return (
                  <li key={r}>
                    <button className="list-row" onClick={() => select({ kind: "repo", id: r })}>
                      <span className="grow">
                        <div className="title">{r}</div>
                        <div className="meta">{last ? `${RUN_LABEL[last.status]} · ${relative(last.queued_at)}` : "No runs"}</div>
                      </span>
                      {last && <span className={`status ${runTone(last.status)}`}>{RUN_LABEL[last.status]}</span>}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
        <section className="card">
          <div className="card-head">
            <h2 className="grow">Recent runs</h2>
          </div>
          <RunTable runs={status.runs.slice(0, 6)} compact />
        </section>
      </div>
    </div>
  );
}

function RunTable({ runs, compact, onPick, picked }: { runs: Run[]; compact?: boolean; onPick?: (id: string) => void; picked?: string }) {
  if (!runs.length) return <div className="empty small">No runs yet.</div>;
  return (
    <table className="table">
      <thead>
        <tr>
          <th>Run</th>
          <th>Status</th>
          {!compact && <th>Duration</th>}
          <th>Tokens</th>
          <th>Est. cost</th>
        </tr>
      </thead>
      <tbody>
        {runs.map((r) => (
          <tr key={r.id} className={picked === r.id ? "selected" : undefined} onClick={() => onPick?.(r.id)} style={onPick ? undefined : { cursor: "default" }}>
            <td>
              <div className="name">{r.repo}</div>
              <div className="desc mono">
                {r.id} · {r.trigger} · {r.depth}
              </div>
            </td>
            <td>
              <span className={`status ${runTone(r.status)}`}>{RUN_LABEL[r.status]}</span>
              <div className="muted small">{relative(r.queued_at)}</div>
            </td>
            {!compact && <td className="small">{duration(r.duration_ms)}</td>}
            <td className="small">{r.usage ? `${tokens(r.usage.input_tokens)} in · ${tokens(r.usage.output_tokens)} out` : "–"}</td>
            <td className="small">{usd(r.cost_usd)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Activity({ runs }: { runs: Run[] }) {
  const intel = useIntel();
  const [picked, setPicked] = useState<string | undefined>(runs[0]?.id);
  const [filter, setFilter] = useState<"all" | "ok" | "problems">("all");
  const shown = runs.filter((r) => filter === "all" || (filter === "ok" ? ["succeeded", "reused"].includes(r.status) : ["failed", "blocked", "interrupted", "cancelled"].includes(r.status)));
  const run = runs.find((r) => r.id === picked);
  return (
    <div className="grid two">
      <section className="card">
        <div className="card-head">
          <h2 className="grow">Run history</h2>
          <label className="field">
            <select value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)} aria-label="Filter runs">
              <option value="all">All runs</option>
              <option value="ok">Completed</option>
              <option value="problems">Failed, blocked or cancelled</option>
            </select>
          </label>
        </div>
        <RunTable runs={shown} onPick={setPicked} picked={picked} />
      </section>
      <section className="card">
        <div className="card-head">
          <h2 className="grow">Trace</h2>
          {run && isActive(run) && (
            <button className="btn" onClick={() => void intel.cancel(run.id)}>
              Cancel run
            </button>
          )}
        </div>
        {!run ? (
          <div className="empty small">Pick a run to see its steps.</div>
        ) : (
          <div className="card-pad selectable" style={{ paddingTop: 4 }}>
            <dl className="kv">
              <dt>Run id</dt>
              <dd className="mono">{run.id}</dd>
              <dt>Repository</dt>
              <dd>{run.repo}</dd>
              <dt>Model</dt>
              <dd>
                {run.model}
                {run.usage?.served_by && run.usage.served_by !== run.model && <div className="muted small">Answered by {run.usage.served_by} (safety fallback)</div>}
              </dd>
              <dt>Timing</dt>
              <dd>
                Queued {formatDate(run.queued_at)} {new Date(run.queued_at).toLocaleTimeString()} · {duration(run.duration_ms)}
              </dd>
              <dt>Requests</dt>
              <dd>
                {run.github_requests} GitHub (GET) · {run.attempts} Claude attempt{run.attempts === 1 ? "" : "s"}
              </dd>
              <dt>Tokens</dt>
              <dd>
                {run.usage ? (
                  <>
                    {run.usage.input_tokens.toLocaleString()} input · {run.usage.output_tokens.toLocaleString()} output
                    {run.usage.cache_read_input_tokens > 0 && ` · ${run.usage.cache_read_input_tokens.toLocaleString()} cache read`}
                    <div className="muted small">Reported by Anthropic</div>
                  </>
                ) : (
                  <span className="muted">None reported{run.attempts > 0 ? " (a timed-out or cancelled request may still be billed)" : ""}</span>
                )}
              </dd>
              <dt>Cost</dt>
              <dd>
                {usd(run.cost_usd)} <span className="muted small">estimated from reported tokens</span>
                {run.estimate && <div className="muted small">Pre-run worst case {usd(run.estimate.worst_case_usd)}</div>}
              </dd>
              {run.error && (
                <>
                  <dt>Error</dt>
                  <dd>
                    <span className="mono">{run.error.kind}</span> · {run.error.message}
                    {run.error.retryable && <div className="muted small">Retryable</div>}
                  </dd>
                </>
              )}
            </dl>
            <ul className="timeline" style={{ marginTop: 16 }}>
              {run.trace.map((s, i) => (
                <li key={i} className={s.ok ? "k-agent" : "k-bad"}>
                  <div className="small">
                    <b>{s.step}</b> {s.detail}
                  </div>
                  <div className="muted small">
                    {new Date(s.at).toLocaleTimeString()}
                    {s.ms != null && ` · ${duration(s.ms)}`}
                  </div>
                </li>
              ))}
              {run.trace.length === 0 && <li className="muted small">{isActive(run) ? "Steps appear when the run finishes." : "No steps recorded."}</li>}
            </ul>
          </div>
        )}
      </section>
    </div>
  );
}

function Costs({ status }: { status: AgentStatus }) {
  const r = useMemo(() => rollup(status.runs), [status.runs]);
  const c = status.config;
  const pct = c.monthly_budget_usd > 0 ? Math.min(100, (status.month_spent_usd / c.monthly_budget_usd) * 100) : 100;
  return (
    <>
      <div className="notice" style={{ marginBottom: 16 }}>
        <Icon name="alert" size={15} />
        <span>
          Token counts are reported by Anthropic for each request. Dollar amounts are <b>estimates</b>: reported tokens times the prices in Settings. Your Anthropic Console shows the billed amounts.
        </span>
      </div>
      <div className="grid tiles" style={{ marginBottom: 16 }}>
        <div className="card tile accent">
          <div className="eyebrow">This month (est.)</div>
          <div className="num">{usd(status.month_spent_usd)}</div>
          <div className="sub">of {usd(c.monthly_budget_usd)} budget</div>
          <div className="bar">
            <i style={{ width: `${pct}%` }} />
          </div>
        </div>
        <div className="card tile">
          <div className="eyebrow">All recorded runs (est.)</div>
          <div className="num">{usd(r.total)}</div>
          <div className="sub">{r.runsWithCost} billed runs in history</div>
        </div>
        <div className="card tile">
          <div className="eyebrow">Tokens reported</div>
          <div className="num">{tokens(r.inputTokens + r.outputTokens)}</div>
          <div className="sub">
            {tokens(r.inputTokens)} in · {tokens(r.outputTokens)} out
          </div>
        </div>
        <div className="card tile">
          <div className="eyebrow">Per-run limit</div>
          <div className="num">{usd(c.max_run_usd, 2)}</div>
          <div className="sub">Checked before each call</div>
        </div>
      </div>
      <div className="grid two">
        <section className="card">
          <div className="card-head">
            <h2 className="grow">By repository</h2>
          </div>
          {r.byRepo.length === 0 ? (
            <div className="empty small">No runs yet.</div>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Repository</th>
                  <th>Runs</th>
                  <th>Claude calls</th>
                  <th>Est. cost</th>
                </tr>
              </thead>
              <tbody>
                {r.byRepo.map((x) => (
                  <tr key={x.repo} style={{ cursor: "default" }}>
                    <td className="name">{x.repo}</td>
                    <td className="small">{x.runs}</td>
                    <td className="small">{x.calls}</td>
                    <td className="small">{x.cost > 0 ? usd(x.cost) : "–"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
        <section className="card">
          <div className="card-head">
            <h2 className="grow">Per run</h2>
          </div>
          <RunTable runs={status.runs.filter((x) => x.cost_usd != null).slice(0, 12)} compact />
        </section>
      </div>
    </>
  );
}
