import { useEffect, useMemo, useState } from "react";
import { Icon } from "../components/Icon";
import { CopyButton, ExternalLink } from "../components/bits";
import { RecActions, RefLinks, RepoLink, TrackingNote } from "../components/IntelLinks";
import { useRecTracking } from "../intel/useTracking";
import { useAtlas } from "../state";
import { useIntel } from "../intel/state";
import { intelApi } from "../intel/api";
import { AREA_LABEL, EFFORT_LABEL, WHEN_LABEL, allFindings, ecosystemContext, isReviewRun, scorecardRows } from "../intel/ecosystem";
import { alertsListUrl, ecoRefTarget, evidenceLinks, recFixRequest, recRepos } from "../intel/links";
import { AI_STATE_LABEL, RUN_LABEL, isActive, usd } from "../intel/format";
import { formatDate, relative } from "../lib/time";
import {
  autonomyMarkdown,
  dataGapsMarkdown,
  quickWinsMarkdown,
  recommendationMarkdown,
  recommendationsMarkdown,
  reviewMarkdown,
  risksMarkdown,
  scorecardMarkdown,
  toolsMarkdown,
  verifiedMarkdown,
} from "../intel/reviewMarkdown";
import type { CostEstimate, Depth, EcoReport, EcoReview, Rating, RepoEntry, Severity } from "../intel/types";

const RATING_CLASS: Record<Rating, string> = { good: "h-good", fair: "h-warn", poor: "h-bad", unknown: "h-unknown" };
const SEV_CLASS: Record<Severity, string> = { critical: "high", high: "high", medium: "medium", low: "low", info: "low" };
const PRIO_CLASS = { now: "p-high", next: "p-medium", later: "" } as const;

/** Who should carry out a recommendation: a catalog agent (opens it), Khaneil, or unknown with the reason. */
export function RecOwner({ owner, report }: { owner?: string | null; report: EcoReport }) {
  const { select } = useAtlas();
  if (!owner)
    return <span title="The review didn't name an owner, or named one that isn't in the catalog, so Atlas doesn't guess.">Owner unknown: the review didn't name one</span>;
  if (owner === "Khaneil" || owner === "KC") return <span title="Needs your own hands: accounts, billing, settings or approvals.">Owner: Khaneil</span>;
  const agent = report.context.agents.find((a) => a.id === owner);
  return (
    <span>
      Owner:{" "}
      <button type="button" className="ref ref-link" title={`Open agent ${agent?.name ?? owner}`} onClick={() => select({ kind: "agent", id: owner })}>
        {agent?.name ?? owner}
      </button>
    </span>
  );
}

/** Intel → Engineering review: run the Senior Engineering Reviewer and read its latest review. */
export function EngineeringReview() {
  const intel = useIntel();
  const { catalog, setView } = useAtlas();
  const context = useMemo(() => ecosystemContext(catalog), [catalog]);
  const runs = (intel.status?.runs ?? []).filter(isReviewRun);
  const active = runs.find(isActive);
  const latest = runs[0];
  const report = intel.review;
  const repoCount = new Set(context.projects.map((p) => p.repository.toLowerCase())).size;

  return (
    <div className="review">
      <section className="card card-pad review-head">
        <div className="grow">
          <div className="eyebrow">Senior Engineering Reviewer · recommendations only</div>
          <p className="small" style={{ margin: "4px 0 0" }}>
            Reviews all {repoCount} catalog repositories and {context.agents.length} agents together: CI, dependencies, security settings, workflow files and each agent's autonomy against its guardrails. It reads GitHub with GET requests only and changes nothing.
          </p>
        </div>
        {report && <span className={`chip ${report.state === "stale" || report.state === "not_assessed" ? "chip-warn" : ""}`}>{AI_STATE_LABEL[report.state]}</span>}
      </section>

      {intel.status && !intel.status.key_present && (
        <div className="notice">
          <Icon name="key" size={15} />
          <span>
            Add an Anthropic API key to run a review.{" "}
            <button className="text-btn" style={{ padding: 0 }} onClick={() => setView("settings")}>
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
        <RunControls report={report} disabled={!intel.status?.key_present} onRun={(depth, force) => intel.runReview(context, { depth, force })} />
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
        <div className="card empty">No review yet. A review costs about $0.10 on Sonnet and reuses saved repository reports to keep GitHub requests and tokens down.</div>
      ) : (
        <>
          {report.review ? <Review report={report} review={report.review} /> : <div className="card empty">{report.note ?? "No Claude review yet."}</div>}
          <VerifiedTable report={report} />
          <div className="muted small">
            Facts gathered {relative(report.updated_at)} with {report.github_requests} GitHub requests; {report.reused_facts} repositories reused saved reports.
            {report.analyzed_at && ` Last successful review ${formatDate(report.analyzed_at)} (${relative(report.analyzed_at)}) with ${report.model}.`}
          </div>
        </>
      )}
    </div>
  );
}

function RunControls({ report, disabled, onRun }: { report: EcoReport | null; disabled: boolean; onRun: (d: Depth, force: boolean) => Promise<unknown> }) {
  const intel = useIntel();
  const [depth, setDepth] = useState<Depth>(intel.status?.config.review?.depth ?? "standard");
  const [confirm, setConfirm] = useState(false);
  const [est, setEst] = useState<CostEstimate | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!confirm) return;
    intelApi.reviewEstimate(depth).then(setEst, (e) => setErr(String(e)));
  }, [confirm, depth]);

  const current = report && (report.state === "analyzed" || report.state === "reused");
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
          <Icon name="spark" size={14} /> {report?.review ? "Review again" : "Run review"}
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
            Up to <b>{usd(est.worst_case_usd)}</b> for this review (estimated worst case; usually much less). Limit {usd(est.max_run_usd)} per review; {usd(est.month_spent_usd)} of {usd(est.monthly_budget_usd)} used this month.
          </>
        ) : (
          "Estimating…"
        )}{" "}
        If nothing changed since the last review, it is reused at no cost.
      </div>
      <div className="notice">Facts about every catalog repository, including private ones (descriptions, CI results, alert summaries, workflow settings) and the catalog's agent list are sent to Anthropic for this review.</div>
      {overBudget && <div className="notice bad">This would go over your spending limits, so the review would be blocked. Change the limits in Settings.</div>}
      {err && <div className="notice bad">{err}</div>}
      <div className="intel-actions">
        <button className="btn primary" onClick={() => void start(false)}>
          Send to Claude
        </button>
        {current && (
          <button className="btn" onClick={() => void start(true)} title="Ask Claude even if nothing changed">
            Review anyway
          </button>
        )}
        <button className="text-btn" onClick={() => setConfirm(false)}>
          Not now
        </button>
      </div>
    </div>
  );
}

const short = (repo: string) => repo.split("/").pop() ?? repo;

function RepoChips({ repos }: { repos: string[] }) {
  if (!repos.length) return null;
  return (
    <span className="chips" style={{ display: "inline-flex" }}>
      {repos.map((r) => (
        <RepoLink key={r} repo={r} />
      ))}
    </span>
  );
}

/** A section title with a small copy button for that section's Markdown. */
function SectionHead({ title, copy }: { title: string; copy: () => string }) {
  return (
    <div className="section-head">
      <div className="section-title">{title}</div>
      <CopyButton compact text={copy} title={`Copy ${title.toLowerCase()}`} />
    </div>
  );
}

export function Review({ report, review }: { report: EcoReport; review: EcoReview }) {
  const agentName = new Map(report.context.agents.map((a) => [a.id, a.name]));
  const resolve = (ref: string) => ecoRefTarget(ref, report);
  const { select } = useAtlas();
  const requestsByRec = useMemo(
    () =>
      review.recommendations.map((r) => {
        const links = evidenceLinks(r.evidence, (ref) => ecoRefTarget(ref, report));
        return recRepos(r, report).map((repo) => recFixRequest({ title: r.title, rationale: r.rationale, firstStep: r.first_step, evidence: r.evidence }, repo, "Engineering review", links));
      }),
    [review, report],
  );
  const tracking = useRecTracking(useMemo(() => requestsByRec.flat(), [requestsByRec]));
  return (
    <div className="ai-box selectable">
      <div className="box-head">
        <div className="box-label">
          <Icon name="spark" size={13} /> Claude's review · AI-generated, not verified
        </div>
        <CopyButton text={() => reviewMarkdown(report, review)} label="Copy review" title="Copy the whole review as Markdown" />
      </div>
      {report.note && <div className="notice">{report.note}</div>}
      <p style={{ margin: 0 }}>{review.summary}</p>

      <div>
        <SectionHead title="Scorecard" copy={() => scorecardMarkdown(review)} />
        <div className="scorecard">
          {scorecardRows(review).map((s) => (
            <div key={s.area} className={`score${s.rated ? "" : " unrated"}`}>
              <span className="health">
                <i className={RATING_CLASS[s.rating]} /> <b>{AREA_LABEL[s.area]}</b>
                <span className="muted small"> {s.rating}</span>
              </span>
              <div className="small">
                {s.rationale} {s.rated && s.evidence.length > 0 && <RefLinks refs={s.evidence} grounded={s.grounded} resolve={resolve} />}
              </div>
            </div>
          ))}
        </div>
      </div>

      {review.top_risks.length > 0 && (
        <div>
          <SectionHead title="Top risks" copy={() => risksMarkdown(review)} />
          <ul className="findings">
            {review.top_risks.map((r, i) => (
              <li key={i}>
                <span className={`sev ${r.severity === "critical" || r.severity === "high" ? "high" : r.severity}`} />
                <span className="grow">
                  <div className="small">
                    <b>{r.title}</b> <RepoChips repos={r.repos} />
                  </div>
                  <div className="muted small">
                    {r.why} <RefLinks refs={r.evidence} grounded={r.grounded} resolve={resolve} />
                  </div>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {review.recommendations.length > 0 && (
        <div>
          <SectionHead title="Recommendations" copy={() => recommendationsMarkdown(review)} />
          <TrackingNote error={tracking?.error} />
          <ol className="recs">
            {review.recommendations.map((r, i) => {
              const requests = requestsByRec[i];
              return (
                <li key={i}>
                  <div className="rec-head">
                    <span className={`prio ${PRIO_CLASS[r.priority]}`}>{WHEN_LABEL[r.priority]}</span>
                    <b className="grow">{r.title}</b>
                    <span className="muted small">{AREA_LABEL[r.category]}</span>
                    <CopyButton compact text={() => recommendationMarkdown(r)} title="Copy this recommendation" />
                  </div>
                  <div className="small muted rec-meta">
                    <RecOwner owner={r.owner} report={report} />
                    <span>Time: {EFFORT_LABEL[r.effort]}</span>
                  </div>
                  <div className="small">{r.rationale}</div>
                  <div className="small">
                    <b>First step:</b> {r.first_step}
                  </div>
                  <div className="small">
                    <RepoChips repos={r.repos} /> <RefLinks refs={r.evidence} grounded={r.grounded} resolve={resolve} />
                  </div>
                  <RecActions requests={requests} tracked={tracking?.byKey} reason="No reviewed repository is named, so there is nowhere to open an issue." />
                </li>
              );
            })}
          </ol>
        </div>
      )}

      {review.tools.length > 0 && (
        <div>
          <SectionHead title="Suggested tools" copy={() => toolsMarkdown(review)} />
          <ul className="obs plain">
            {review.tools.map((t, i) => (
              <li key={i}>
                <b>{t.name}</b> <span className="chip">{t.cost}</span> {t.purpose} <span className="muted">{t.why}</span> <RepoChips repos={t.repos} />
              </li>
            ))}
          </ul>
        </div>
      )}

      {review.autonomy_notes.length > 0 && (
        <div>
          <SectionHead title="Autonomy" copy={() => autonomyMarkdown(review, (id) => agentName.get(id) ?? id)} />
          <ul className="obs plain">
            {review.autonomy_notes.map((n, i) => (
              <li key={i}>
                {agentName.has(n.agent) ? (
                  <button type="button" className="text-btn inline" style={{ padding: 0 }} onClick={() => select({ kind: "agent", id: n.agent })}>
                    <b>{agentName.get(n.agent)}</b>
                  </button>
                ) : (
                  <b>{n.agent}</b>
                )}{" "}
                <span className="chip">
                  L{n.current_level} → L{n.suggested_level}
                </span>{" "}
                {n.reason} <RefLinks refs={n.evidence} grounded={n.grounded} resolve={resolve} />
              </li>
            ))}
          </ul>
        </div>
      )}

      {review.quick_wins.length > 0 && (
        <div>
          <SectionHead title="Quick wins (under an hour)" copy={() => quickWinsMarkdown(review)} />
          <ul className="obs">
            {review.quick_wins.map((q, i) => (
              <li key={i}>{q}</li>
            ))}
          </ul>
        </div>
      )}

      {review.data_gaps.length > 0 && (
        <div>
          <SectionHead title="Couldn't assess" copy={() => dataGapsMarkdown(review)} />
          <ul className="obs">
            {review.data_gaps.map((q, i) => (
              <li key={i}>{q}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

const UNKNOWN_NO_CHECKS = "Unknown: settings were not read for this repository";
const yes = (a: { state: "assessed"; data: boolean } | { state: "not_assessed"; reason: string } | undefined) =>
  !a ? <Unknown why={UNKNOWN_NO_CHECKS} /> : a.state === "assessed" ? (a.data ? "Yes" : "No") : <Unknown why={a.reason} />;

/** "Unknown", with the reason one hover or tap away and readable by screen readers. */
function Unknown({ why }: { why: string }) {
  return (
    <span className="muted" title={why}>
      Unknown<span className="sr-only">: {why}</span>
    </span>
  );
}

function alertsCell(e: RepoEntry) {
  const f = e.facts;
  if (!f) return <Unknown why={e.error ?? "Facts could not be read"} />;
  const d = f.security.dependabot;
  const c = f.security.code_scanning;
  const part = (label: string, s: typeof d, kind: "dependabot" | "code_scanning") =>
    s.state === "assessed" ? (
      <ExternalLink href={alertsListUrl(f.url, kind)}>
        {label} {s.data.open}
      </ExternalLink>
    ) : (
      <span className="muted" title={s.reason}>
        {label} unknown
      </span>
    );
  return (
    <>
      {part("Dependabot", d, "dependabot")}
      <div>{part("Code scanning", c, "code_scanning")}</div>
    </>
  );
}

function rulesLabel(e: RepoEntry) {
  const r = e.checks?.branch_rules;
  if (!r) return <Unknown why={UNKNOWN_NO_CHECKS} />;
  if (r.state !== "assessed") return <Unknown why={r.reason} />;
  return r.data.protected ? (r.data.required_checks.length ? `Protected · ${r.data.required_checks.length} checks` : "Protected") : "None";
}

export function VerifiedTable({ report }: { report: EcoReport }) {
  const findings = allFindings(report);
  const [open, setOpen] = useState(false);
  return (
    <section className="verified-box selectable">
      <div className="box-head">
        <div className="box-label">
          <Icon name="check" size={13} /> Verified from GitHub · {report.repos.length} repositories
        </div>
        {findings.length > 0 && <CopyButton compact text={() => verifiedMarkdown(report)} title="Copy verified findings" />}
      </div>
      <div className="table-wrap">
        <table className="table compact">
          <thead>
            <tr>
              <th>Repository</th>
              <th>CI</th>
              <th>Alerts</th>
              <th>Branch rules</th>
              <th>Dependabot config</th>
              <th>Workflows</th>
            </tr>
          </thead>
          <tbody>
            {report.repos.map((e) => {
              const f = e.facts;
              const wf = e.checks?.workflows;
              const flagged = wf?.state === "assessed" ? wf.data.filter((w) => w.pull_request_target || w.unpinned_actions.length || (!w.top_level_permissions && !w.job_permissions)).length : 0;
              return (
                <tr key={e.repo} style={{ cursor: "default" }}>
                  <td>
                    <div className="name">{f ? <ExternalLink href={f.url}>{short(e.repo)}</ExternalLink> : short(e.repo)}</div>
                    <div className="desc">{e.error ?? (e.source === "intel_report" ? "From saved report" : "Read for this review")}</div>
                  </td>
                  <td className="small">{f ? f.ci.state.replace("_", " ") : <Unknown why={e.error ?? "Facts could not be read"} />}</td>
                  <td className="small">{alertsCell(e)}</td>
                  <td className="small">{rulesLabel(e)}</td>
                  <td className="small">{yes(e.checks?.dependabot_config)}</td>
                  <td className="small">{e.checks ? `${e.checks.workflow_files}${flagged ? ` · ${flagged} flagged` : ""}` : <Unknown why={UNKNOWN_NO_CHECKS} />}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {findings.length > 0 && (
        <div>
          <button className="text-btn" style={{ padding: 0 }} onClick={() => setOpen(!open)}>
            {open ? "Hide" : "Show"} {findings.length} verified findings
          </button>
          {open && (
            <ul className="findings" style={{ marginTop: 8 }}>
              {findings.map((x) => (
                <li key={`${x.repo}:${x.id}`}>
                  <span className={`sev ${SEV_CLASS[x.severity]}`} />
                  <span className="grow">
                    <div className="small">
                      <b>{short(x.repo)}</b> · {x.url ? <ExternalLink href={x.url}>{x.title}</ExternalLink> : x.title}
                    </div>
                    <div className="muted small">{x.detail}</div>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
