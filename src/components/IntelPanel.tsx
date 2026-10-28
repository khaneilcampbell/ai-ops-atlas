import { useEffect, useState } from "react";
import { Icon } from "./Icon";
import { ExternalLink } from "./bits";
import { useAtlas } from "../state";
import { useIntel } from "../intel/state";
import { intelApi } from "../intel/api";
import { AI_STATE_LABEL, RUN_LABEL, isActive, usd } from "../intel/format";
import { formatDate, relative } from "../lib/time";
import type { AiAnalysis, CostEstimate, Depth, Facts, Observation, Rating, Report, Severity } from "../intel/types";

const SEV_CLASS: Record<Severity, string> = { critical: "high", high: "high", medium: "medium", low: "low", info: "low" };
const RATING_CLASS: Record<Rating, string> = { good: "h-good", fair: "h-warn", poor: "h-bad", unknown: "h-unknown" };
const CI_LABEL: Record<Facts["ci"]["state"], [string, string]> = {
  passing: ["Passing", "h-good"],
  failing: ["Failing", "h-bad"],
  running: ["Running", "h-warn"],
  no_runs: ["No workflow runs", "h-unknown"],
  not_assessed: ["Not assessed", "h-unknown"],
};

/** The intelligence section of a repository's detail panel. */
export function IntelPanel({ repo }: { repo: string }) {
  const intel = useIntel();
  const { catalog, setView, select } = useAtlas();
  const report = intel.reports[repo.toLowerCase()];
  const runs = (intel.status?.runs ?? []).filter((r) => r.repo.toLowerCase() === repo.toLowerCase());
  const active = runs.find(isActive);
  const latest = runs[0];

  if (!intel.available) {
    return (
      <div>
        <div className="section-title">Repository intelligence</div>
        <div className="muted small">Available in the desktop app, where the Anthropic key is kept in the Keychain.</div>
      </div>
    );
  }

  const project = catalog.projects.find((p) => p.repository.toLowerCase() === repo.toLowerCase());
  const context = { project: project?.name ?? null, agents: catalog.agents.filter((a) => a.repository.toLowerCase() === repo.toLowerCase()).map((a) => a.name) };

  return (
    <div className="intel">
      <div className="intel-head">
        <div className="section-title grow" style={{ marginBottom: 0 }}>
          Repository intelligence
        </div>
        {report && <span className={`chip ${report.ai_state === "stale" || report.ai_state === "not_assessed" ? "chip-warn" : ""}`}>{AI_STATE_LABEL[report.ai_state]}</span>}
      </div>

      {intel.status && !intel.status.key_present && (
        <div className="notice">
          <Icon name="key" size={15} />
          <span>
            Add an Anthropic API key to run analysis.{" "}
            <button
              className="text-btn"
              style={{ padding: 0 }}
              onClick={() => {
                select(null);
                setView("settings");
              }}
            >
              Open Settings
            </button>
          </span>
        </div>
      )}

      {active ? (
        <div className="intel-running">
          <Icon name="refresh" size={14} className="spin" />
          <span className="grow small">
            {RUN_LABEL[active.status]}
            {active.status === "running" && active.estimate ? ` · up to ${usd(active.estimate.worst_case_usd)}` : ""}
            <span className="muted mono"> {active.id}</span>
          </span>
          <button className="btn" onClick={() => void intel.cancel(active.id)}>
            Cancel
          </button>
        </div>
      ) : (
        <AnalyzeControls repo={repo} report={report} isPrivate={report?.facts.visibility === "private"} disabled={!intel.status?.key_present} onRun={(depth, force) => intel.analyze(repo, { depth, force, context })} />
      )}

      {latest && !isActive(latest) && latest.error && (
        <div className="notice bad">
          <Icon name="alert" size={15} />
          <span>
            <b>{RUN_LABEL[latest.status]}:</b> {latest.error.message}
            <span className="muted"> ({relative(latest.finished_at)})</span>
          </span>
        </div>
      )}

      {!report ? (
        <div className="muted small">Not analyzed yet. An analysis reads this repository from GitHub (read-only) and asks Claude for a structured assessment.</div>
      ) : (
        <>
          <Verified report={report} />
          {report.ai ? <Assessment report={report} ai={report.ai} /> : <div className="muted small">{report.note ?? "No Claude assessment yet."}</div>}
          <div className="muted small">
            Facts collected {relative(report.facts.collected_at)} with {report.facts.github_requests} GitHub requests.
            {report.analyzed_at && ` Last successful analysis ${formatDate(report.analyzed_at)} (${relative(report.analyzed_at)}) with ${report.model}.`}
          </div>
        </>
      )}
    </div>
  );
}

function AnalyzeControls({ repo, report, isPrivate, disabled, onRun }: { repo: string; report?: Report; isPrivate: boolean; disabled: boolean; onRun: (d: Depth, force: boolean) => Promise<unknown> }) {
  const intel = useIntel();
  const [depth, setDepth] = useState<Depth>(intel.status?.config.depth ?? "standard");
  const [confirm, setConfirm] = useState(false);
  const [est, setEst] = useState<CostEstimate | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!confirm) return;
    intelApi.estimate(depth).then(setEst, (e) => setErr(String(e)));
  }, [confirm, depth]);

  useEffect(() => setConfirm(false), [repo]);

  const current = report && (report.ai_state === "analyzed" || report.ai_state === "reused");
  const overBudget = est && (est.worst_case_usd > est.max_run_usd || est.month_spent_usd + est.worst_case_usd > est.monthly_budget_usd);
  const start = async (force: boolean) => {
    setErr(null);
    try {
      await onRun(depth, force);
      setConfirm(false);
    } catch (e) {
      setErr(String(e));
    }
  };

  if (!confirm) {
    return (
      <div className="intel-actions">
        <button className="btn primary" disabled={disabled} onClick={() => setConfirm(true)}>
          <Icon name="spark" size={14} /> {report?.ai ? "Analyze again" : "Analyze repository"}
        </button>
      </div>
    );
  }
  return (
    <div className="intel-confirm">
      <div className="intel-actions">
        <label className="field">
          <label>Depth</label>
          <select value={depth} onChange={(e) => setDepth(e.target.value as Depth)}>
            <option value="quick">Quick · {intel.status?.config.models.quick}</option>
            <option value="standard">Standard · {intel.status?.config.models.standard}</option>
            <option value="deep">Deep · {intel.status?.config.models.deep}</option>
          </select>
        </label>
      </div>
      <div className="small">
        {est ? (
          <>
            Up to <b>{usd(est.worst_case_usd)}</b> for this run (estimated worst case; usually much less). {usd(est.month_spent_usd)} of {usd(est.monthly_budget_usd)} used this month.
          </>
        ) : (
          "Estimating…"
        )}{" "}
        Unchanged repositories reuse the last analysis at no cost.
      </div>
      {isPrivate && <div className="notice">This is a private repository. Its README, manifests, commit messages and issue titles will be sent to Anthropic for analysis.</div>}
      {overBudget && <div className="notice bad">This would go over your spending limits, so the run would be blocked. Change the limits in Settings.</div>}
      {err && <div className="notice bad">{err}</div>}
      <div className="intel-actions">
        <button className="btn primary" onClick={() => void start(false)}>
          Send to Claude
        </button>
        {current && (
          <button className="btn" onClick={() => void start(true)} title="Ask Claude even if nothing changed">
            Re-analyze anyway
          </button>
        )}
        <button className="text-btn" onClick={() => setConfirm(false)}>
          Not now
        </button>
      </div>
    </div>
  );
}

function Verified({ report }: { report: Report }) {
  const f = report.facts;
  const [ciLabel, ciClass] = CI_LABEL[f.ci.state];
  const issues = f.issues.state === "assessed" ? `${f.issues.data.open}` : "not assessed";
  const release = f.releases.state === "assessed" ? (f.releases.data[0] ? `${f.releases.data[0].tag} (${formatDate(f.releases.data[0].published_at)})` : "none") : "not assessed";
  const sec = (s: Facts["security"]["dependabot"]) => (s.state === "assessed" ? `${s.data.open} open` : `not assessed: ${s.reason}`);
  return (
    <div className="verified-box">
      <div className="box-label">
        <Icon name="check" size={13} /> Verified from GitHub
      </div>
      <dl className="kv">
        <dt>CI</dt>
        <dd>
          <span className="health">
            <i className={ciClass} /> {ciLabel}
          </span>
          {f.ci.note && <div className="muted small">{f.ci.note}</div>}
        </dd>
        <dt>Activity</dt>
        <dd>
          {f.activity.commits_last_30d} commits in 30 days (of {f.activity.commits_sampled} sampled); last {f.activity.last_commit_at ? relative(f.activity.last_commit_at) : "unknown"}
          <div className="muted small">
            {f.activity.branches ?? "?"} branches · {f.activity.open_prs ?? "?"} open PRs · {issues} open issues · latest release {release}
          </div>
        </dd>
        <dt>Technologies</dt>
        <dd>
          {f.stack.length || f.agent_signals.length ? (
            <div className="chips">
              {f.stack.map((s) => (
                <span key={s} className="chip">
                  {s}
                </span>
              ))}
              {f.agent_signals.map((s) => (
                <span key={s} className="chip chip-gold">
                  {s}
                </span>
              ))}
            </div>
          ) : (
            <span className="muted">Nothing detected from root files</span>
          )}
          {f.languages.length > 0 && <div className="muted small">{f.languages.slice(0, 4).map((l) => `${l.name} ${l.percent}%`).join(" · ")}</div>}
        </dd>
        <dt>Docs</dt>
        <dd>
          README {f.docs.readme ? `(${f.docs.readme_chars.toLocaleString()} chars)` : "missing"} · license {f.docs.license ?? "none"}
          {f.docs.contributing && " · CONTRIBUTING"}
          {f.docs.changelog && " · CHANGELOG"}
          {f.docs.docs_dir && " · docs/"}
        </dd>
        <dt>Security alerts</dt>
        <dd>
          Dependabot {sec(f.security.dependabot)}
          <div className="muted small">Code scanning {sec(f.security.code_scanning)}</div>
        </dd>
      </dl>
      {report.findings.length > 0 && (
        <ul className="findings">
          {report.findings.map((x) => (
            <li key={x.id}>
              <span className={`sev ${SEV_CLASS[x.severity]}`} />
              <span className="grow">
                <div className="small">{x.url ? <ExternalLink href={x.url}>{x.title}</ExternalLink> : x.title}</div>
                <div className="muted small">{x.detail}</div>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function Refs({ refs, grounded }: { refs: string[]; grounded: boolean }) {
  if (!grounded) return <span className="ref ungrounded">no supporting reference</span>;
  return (
    <>
      {refs.map((r) => (
        <span key={r} className="ref">
          {r}
        </span>
      ))}
    </>
  );
}

function ObsList({ title, items, note }: { title: string; items: Observation[]; note?: string }) {
  if (!items.length) return null;
  return (
    <div>
      <div className="section-title">{title}</div>
      {note && <div className="muted small" style={{ marginBottom: 6 }}>{note}</div>}
      <ul className="obs">
        {items.map((o, i) => (
          <li key={i}>
            {o.text} <Refs refs={o.evidence} grounded={o.grounded} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function Assessment({ report, ai }: { report: Report; ai: AiAnalysis }) {
  return (
    <div className="ai-box">
      <div className="box-label">
        <Icon name="spark" size={13} /> Claude's assessment · AI-generated, not verified
      </div>
      {report.note && <div className="notice">{report.note}</div>}
      <p style={{ margin: 0 }}>{ai.summary}</p>
      <dl className="kv">
        <dt>Purpose</dt>
        <dd>{ai.purpose || <span className="muted">Unclear from the data</span>}</dd>
        <dt>Architecture</dt>
        <dd>{ai.architecture}</dd>
        <dt>Maturity</dt>
        <dd>
          <span className="chip">{ai.maturity.replace(/_/g, " ")}</span> {ai.implementation_status}
        </dd>
        {ai.agent_integrations.length > 0 && (
          <>
            <dt>Agent integrations</dt>
            <dd>{ai.agent_integrations.join(", ")}</dd>
          </>
        )}
      </dl>
      {ai.health.length > 0 && (
        <div>
          <div className="section-title">Health</div>
          <ul className="obs plain">
            {ai.health.map((h) => (
              <li key={h.area}>
                <span className="health">
                  <i className={RATING_CLASS[h.rating]} /> <b>{h.area.replace(/_/g, " ")}</b>
                </span>{" "}
                {h.rationale} <Refs refs={h.evidence} grounded={h.grounded} />
              </li>
            ))}
          </ul>
        </div>
      )}
      {ai.recommendations.length > 0 && (
        <div>
          <div className="section-title">Recommended next tasks</div>
          <ol className="recs">
            {ai.recommendations.map((r, i) => (
              <li key={i}>
                <span className={`prio p-${r.priority}`}>{r.priority}</span> <b>{r.title}</b>
                <div className="small">
                  {r.rationale} <Refs refs={r.evidence} grounded={r.grounded} />
                </div>
              </li>
            ))}
          </ol>
        </div>
      )}
      <ObsList title="Maintenance issues" items={ai.maintenance_issues} />
      <ObsList title="Documentation gaps" items={ai.documentation_gaps} />
      <ObsList title="Technical debt indicators" items={ai.technical_debt} />
      <ObsList title="Security observations" items={ai.security_observations} note="Hypotheses for you to check. These are not confirmed vulnerabilities; confirmed alerts appear under Verified." />
      {ai.data_gaps.length > 0 && (
        <div className="muted small">
          <b>Couldn't assess:</b> {ai.data_gaps.join("; ")}
        </div>
      )}
      {report.validation && (report.validation.dropped_refs > 0 || report.validation.ungrounded_items > 0) && (
        <div className="muted small">
          Validation removed {report.validation.dropped_refs} citation{report.validation.dropped_refs === 1 ? "" : "s"} that didn't match the data; {report.validation.ungrounded_items} item
          {report.validation.ungrounded_items === 1 ? " has" : "s have"} no supporting reference.
        </div>
      )}
    </div>
  );
}
