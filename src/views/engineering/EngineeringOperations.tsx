import { useMemo, useState } from "react";
import { summariseEngineering, useEngineering } from "../../engineering/client";
import { ACTIVITY_LABEL } from "../../engineering/lifecycle";
import { CATEGORY_LABEL, PHASE_LABEL, type EngineeringOverview, type ExecutionView, type IncidentView } from "../../engineering/types";
import { formatDateTime } from "../../lib/timezone";
import "../../styles/executive.css";

// Mission Control > Engineering Operations. The Engineering Division's records from the Atlas
// database (incidents, executions, QA reports, pull requests, model spend). Read only: repairs start
// from CI failures, approvals go through the Executive panel above, and nothing here merges.

const gh = (repo: string, path = "") => `https://github.com/${repo}${path}`;
const short = (sha: string | null) => (sha ? sha.slice(0, 7) : "none");
const usd = (n: number) => `$${n.toFixed(2)}`;
const tone = (s: string | null) => (s === "PASS" || s === "PR_READY" || s === "pr_open" || s === "resolved" ? "good" : s === "FAIL" || s === "FAILED" || s === "failed" ? "bad" : s === "BLOCKED" || s === "NEEDS_REVIEW" || s === "AWAITING_APPROVAL" || s === "escalated" || s === "awaiting_approval" ? "warn" : "");

const INCIDENT_LABEL: Record<IncidentView["status"], string> = {
  detected: "Detected",
  assigned: "Assigned",
  awaiting_approval: "Waiting for approval",
  repairing: "Repairing",
  pr_open: "Pull request open",
  resolved: "Resolved",
  escalated: "Sent to Khaneil",
  failed: "Failed",
  ignored: "Ignored",
};

export function EngineeringOperations() {
  const { data, refresh } = useEngineering();
  return (
    <section className="card exec-ctl" aria-label="Engineering Operations">
      <div className="card-head exec-head">
        <h2 className="grow">Engineering Operations</h2>
        {data.state === "ready" && <span className="muted small">{summariseEngineering(data.value).line}</span>}
        {data.state === "ready" && (
          <button className="btn small" onClick={refresh}>
            Refresh
          </button>
        )}
      </div>
      <p className="muted small exec-pad">
        Atlas Engineering repairs simple lint, type and unit test failures on main; Atlas QA checks each change from GitHub's own records before a pull request opens. Nothing merges: you do.
      </p>
      {data.state === "loading" && <p className="muted small exec-pad">Loading…</p>}
      {(data.state === "off" || data.state === "not-configured" || data.state === "error") && <p className={`small exec-pad ${data.state === "error" ? "task-error" : "muted"}`}>{data.message}</p>}
      {data.state === "ready" && <Ready o={data.value} />}
    </section>
  );
}

function Ready({ o }: { o: EngineeringOverview }) {
  const s = useMemo(() => summariseEngineering(o), [o]);
  const [open, setOpen] = useState<string | null>(s.running[0]?.id ?? o.executions[0]?.id ?? null);
  return (
    <>
      {s.setup.length > 0 && <p className="muted small exec-pad">Not running for real yet: {s.setup.join("; ")}.</p>}
      <div className="exec-kpis exec-pad">
        <Kpi label="CI failures seen" value={s.failedCi} />
        <Kpi label="Running" value={s.running.length} />
        <Kpi label="QA passed" value={s.qaPassed} sub={s.qaFailed ? `${s.qaFailed} sent back` : undefined} />
        <Kpi label="Pull requests" value={s.prsOpen} />
        <Kpi label="Failures" value={s.failures} warn={s.failures > 0} />
        <Kpi label="Model spend, 30 days" value={usd(o.spend.last30Usd)} sub={`${o.spend.runs30} runs · ${Math.round(o.spend.inputTokens30 / 1000)}k in / ${Math.round(o.spend.outputTokens30 / 1000)}k out`} />
      </div>
      <div className="exec-grid">
        <div className="exec-col">
          <h3 className="exec-h">Agents</h3>
          {o.agents.map((a) => (
            <div key={a.id} className="exec-goal-top eng-row">
              <span className="exec-goal-title">{a.name}</span>
              <span className="exec-goal-meta">
                <span className={`chip ${a.activity === "BLOCKED" ? "warn" : a.activity === "IDLE" ? "" : "good"}`}>{ACTIVITY_LABEL[a.activity]}</span>
                <span className="muted small">{a.status === "active" ? "Available" : a.status === "paused" ? "Paused" : a.status}</span>
              </span>
            </div>
          ))}
          <h3 className="exec-h">Monitored repositories</h3>
          {o.repos.map((r) => (
            <p key={r.repo} className="small">
              <a href={gh(r.repo)} target="_blank" rel="noreferrer">
                {r.repo}
              </a>{" "}
              <span className="muted">
                · {r.defaultBranch} · {r.autoRepair ? "repairs within limits" : "each repair needs approval"} · {r.lastCheckedAt ? `checked ${formatDateTime(r.lastCheckedAt)} at ${short(r.lastSeenSha)}` : "not checked yet"}
              </span>
            </p>
          ))}
          <h3 className="exec-h">CI failures</h3>
          {o.incidents.length === 0 && <p className="muted small">No CI failures recorded.</p>}
          {o.incidents.slice(0, 8).map((i) => (
            <div key={i.id} className="exec-goal">
              <div className="exec-goal-top eng-row">
                <span className="exec-goal-title">
                  {i.source === "fixture" && <span className="chip warn">Local fixture</span>} {i.workflowName} · {CATEGORY_LABEL[i.category]} at {short(i.headSha)}
                </span>
                <span className="exec-goal-meta">
                  <span className={`chip ${tone(i.status)}`}>{INCIDENT_LABEL[i.status]}</span>
                  <span className="muted small">{formatDateTime(i.createdAt)}</span>
                </span>
              </div>
              {i.decision && (i.status === "escalated" || i.status === "failed" || i.status === "ignored") && <p className="small muted exec-pad">{i.decision}</p>}
              <p className="small exec-pad">
                {i.runUrl && (
                  <a href={i.runUrl} target="_blank" rel="noreferrer">
                    Failed run
                  </a>
                )}
                {i.goalId && <span className="muted"> · goal {i.goalId.slice(0, 8)}</span>}
                {i.ownerTaskId && <span className="muted"> · Task Center {i.ownerTaskId.slice(0, 8)}</span>}
              </p>
            </div>
          ))}
        </div>
        <div className="exec-col">
          <h3 className="exec-h">Executions</h3>
          {o.executions.length === 0 && <p className="muted small">No engineering runs yet.</p>}
          {o.executions.map((e) => (
            <Execution key={e.id} e={e} fixture={o.incidents.find((i) => i.id === e.incidentId)?.source === "fixture"} open={open === e.id} toggle={() => setOpen(open === e.id ? null : e.id)} />
          ))}
        </div>
      </div>
    </>
  );
}

function Execution({ e, fixture, open, toggle }: { e: ExecutionView; fixture: boolean; open: boolean; toggle: () => void }) {
  return (
    <div className="exec-goal">
      <button className="exec-goal-top" onClick={toggle} aria-expanded={open}>
        <span className="exec-goal-title">
          {fixture && <span className="chip warn">Local fixture</span>} {e.repairIteration ? `Repair ${e.repairIteration}` : "First attempt"} · {e.branch ?? "no branch yet"}
        </span>
        <span className="exec-goal-meta">
          <span className={`chip ${tone(e.phase)}`}>{PHASE_LABEL[e.phase]}</span>
          {e.qaOutcome && <span className={`chip ${tone(e.qaOutcome)}`}>QA {e.qaOutcome.replace("_", " ").toLowerCase()}</span>}
          <span className="muted small">{usd(e.costUsd)}</span>
        </span>
      </button>
      {open && (
        <div className="exec-goal-body">
          <p className="small">
            Goal {e.goalId.slice(0, 8)} · task {e.taskRecordId ? `Task Center ${e.taskRecordId.slice(0, 8)}` : e.taskId.slice(0, 8)} · Atlas Engineering ·{" "}
            <a href={gh(e.repo)} target="_blank" rel="noreferrer">
              {e.repo}
            </a>{" "}
            · base{" "}
            <a href={gh(e.repo, `/commit/${e.baseSha}`)} target="_blank" rel="noreferrer">
              {short(e.baseSha)}
            </a>
            {e.headSha && (
              <>
                {" "}
                · fix{" "}
                <a href={gh(e.repo, `/commit/${e.headSha}`)} target="_blank" rel="noreferrer">
                  {short(e.headSha)}
                </a>
              </>
            )}
          </p>
          <p className="small">
            {e.runnerUrl ? (
              <a href={e.runnerUrl} target="_blank" rel="noreferrer">
                Runner logs
              </a>
            ) : (
              <span className="muted">No runner run yet</span>
            )}
            {e.prUrl && (
              <>
                {" · "}
                <a href={e.prUrl} target="_blank" rel="noreferrer">
                  Pull request #{e.prNumber}
                </a>
              </>
            )}
            <span className="muted">
              {" "}
              · {e.model ?? "model not reported"}
              {e.inputTokens !== null ? ` · ${e.inputTokens.toLocaleString()} in / ${(e.outputTokens ?? 0).toLocaleString()} out` : ""}
              {e.turns !== null ? ` · ${e.turns} turns` : ""}
            </span>
          </p>
          {e.filesChanged.length > 0 && <p className="small muted">Files: {e.filesChanged.join(", ")}</p>}
          {e.error && <p className="small exec-why">{e.error}</p>}
          {e.qaReport && (
            <details open={e.qaReport.outcome !== "PASS"}>
              <summary className="small">
                QA report: {e.qaReport.outcome}, {e.qaReport.checks.filter((c) => c.passed).length} of {e.qaReport.checks.length} checks passed
              </summary>
              <ul className="small exec-steps">
                {e.qaReport.checks.map((c) => (
                  <li key={c.name} className={c.passed ? "" : "exec-why"}>
                    {c.passed ? "✓" : "✗"} {c.name}
                    {c.detail ? ` (${c.detail})` : ""} <span className="muted">· {c.source === "github" ? "from GitHub" : "Atlas rule"}</span>
                  </li>
                ))}
              </ul>
              {e.qaReport.feedback.length > 0 && <p className="small">Sent back with: {e.qaReport.feedback.join(" ")}</p>}
            </details>
          )}
          {!e.qaReport && e.claimedValidation.length > 0 && <p className="small muted">The runner reported {e.claimedValidation.filter((v) => v.passed).length} of {e.claimedValidation.length} checks passing; QA hasn't confirmed it from GitHub yet.</p>}
        </div>
      )}
    </div>
  );
}

function Kpi({ label, value, sub, warn }: { label: string; value: string | number; sub?: string; warn?: boolean }) {
  return (
    <div className={`exec-kpi${warn ? " warn" : ""}`}>
      <div className="exec-kpi-num">{value}</div>
      <div className="exec-kpi-label">{label}</div>
      {sub && <div className="muted small">{sub}</div>}
    </div>
  );
}
