import { useEffect, useMemo, useState } from "react";
import { useActions } from "../../actions/state";
import { appOrchestrator } from "../../execution/app";
import { pullReports } from "../../execution/bridgeClient";
import { liveAttempt } from "../../tasks/lifecycle";
import { useLedgers, emptyLedger } from "../../execution/ledger";
import { goalReport, RUN_STATUS_LABEL } from "../../execution/report";
import type { RunLedger } from "../../execution/types";
import type { StepSummary } from "../../execution/orchestrator";
import { formatDateTime } from "../../lib/timezone";
import { useAtlas } from "../../state";
import { type ExecContext } from "../../tasks/adapters";
import { KHANEIL, type StoredTask } from "../../tasks/types";
import type { WorkflowRun } from "../../workflows/types";
import { RunIntelligence } from "./RunIntelligence";

// Execution panel for a live run: a person lets Atlas coordinate it, then every Task Center change
// moves it one round (no polling loop). Shows what's waiting on whom, what can't run and why, and
// the goal report with the technical result kept apart from the business outcome.

const fmtDur = (ms: number | null) => (ms === null ? "—" : ms < 3_600_000 ? `${Math.round(ms / 60_000)} min` : `${(ms / 3_600_000).toFixed(1)} h`);

export function useRunLedger(runId: string | undefined): RunLedger | undefined {
  const all = useLedgers();
  return runId ? (all.find((l) => l.runId === runId) ?? emptyLedger(runId)) : undefined;
}

export function RunExecution({ run, tasks, names }: { run: WorkflowRun; tasks: ReadonlyMap<string, StoredTask>; names: (id: string) => string }) {
  const { catalog } = useAtlas();
  const actions = useActions();
  const ctx: ExecContext = { desktop: actions.available, agentsToken: !!actions.status?.agents_token };
  const orch = appOrchestrator(catalog, ctx);
  const ledger = useRunLedger(run.id)!;
  const [summary, setSummary] = useState<StepSummary | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [outcome, setOutcome] = useState({ state: "too_early" as "achieved" | "not_achieved" | "too_early", note: "", metric: "", value: "", source: "" });

  // One round per change to the tasks or the ledger. Rounds are idempotent, so a repeat does nothing.
  useEffect(() => {
    if (!ledger.startedBy || ledger.cancelledAt) return;
    let live = true;
    void orch.step(run.id).then((r) => live && r.ok && setSummary(r.summary));
    return () => {
      live = false;
    };
  }, [orch, run.id, tasks, ledger.startedBy, ledger.cancelledAt, ledger.rev]);

  // While a step is out with n8n, pick up its reports: on each change and once a minute while the
  // window is visible. Stops by itself when nothing is out.
  const outWithN8n = useMemo(() => Object.values(run.nodeTasks).some((id) => liveAttempt(tasks.get(id) ?? ({ attempts: [] } as unknown as StoredTask))?.executor === "n8n"), [run, tasks]);
  useEffect(() => {
    if (!outWithN8n) return;
    const pull = () => {
      if (document.visibilityState === "visible") void pullReports(orch).catch(() => {});
    };
    pull();
    const t = setInterval(pull, 60_000);
    return () => clearInterval(t);
  }, [outWithN8n, orch]);

  const stuck = useMemo(() => new Map<string, "person" | "unconfigured">([...(summary?.unconfigured ?? []).map((u) => [u.nodeId, "unconfigured"] as const), ...(summary?.waitingOnPerson ?? []).map((w) => [w.nodeId, "person"] as const)]), [summary]);
  const report = useMemo(() => goalReport(run, tasks, ledger, new Date().toISOString(), stuck), [run, tasks, ledger, stuck]);
  const done = (r: { ok: boolean; error?: string }, ok: string) => setMsg(r.ok ? ok : (r.error ?? "Not done."));
  const decision = run.snapshot.nodes.find((n) => n.kind === "decision" && tasks.get(run.nodeTasks[n.id] ?? "")?.status === "queued");

  return (
    <div className="wf-exec">
      <div className="wf-exec-head">
        <span className={`chip wf-run-${report.status}`}>{RUN_STATUS_LABEL[report.status]}</span>
        <span className="chip">Live · device only</span>
        {ledger.startedBy && <span className="muted small">Coordinating since {formatDateTime(ledger.startedAt!)} · allowed by {ledger.startedBy}</span>}
      </div>
      {!ledger.startedBy ? (
        <div className="wf-confirm">
          <span>Let Atlas coordinate this run? It releases steps as earlier ones finish, asks you for approvals and sends steps only to integrations that can run them.</span>
          <button className="btn small primary" onClick={() => done(orch.authorize(run.id, KHANEIL), "Atlas is coordinating this run.")}>
            Start coordinating
          </button>
        </div>
      ) : (
        !ledger.cancelledAt &&
        report.status !== "completed" && (
          <button className="btn small" onClick={() => done(orch.cancelRun(run.id, KHANEIL), "Run cancelled.")}>
            Cancel run
          </button>
        )
      )}
      {decision && (
        <div className="wf-confirm">
          <span>{decision.title}</span>
          <button className="btn small primary" onClick={() => done(orch.decide(run.id, decision.id, "yes", KHANEIL), "Recorded: go ahead.")}>
            Go ahead
          </button>
          <button className="btn small" onClick={() => done(orch.decide(run.id, decision.id, "no", KHANEIL), "Recorded: idea parked.")}>
            Park it
          </button>
        </div>
      )}
      {Object.entries(ledger.needsReconcile).map(([nodeId, why]) => (
        <div key={nodeId} className="wf-confirm">
          <span>
            <b>{names(nodeId)}:</b> {why}
          </span>
          <button className="btn small" onClick={() => done(orch.resolveUnknown(run.id, nodeId, "succeeded", KHANEIL), "Recorded as run.")}>
            It ran
          </button>
          <button className="btn small" onClick={() => done(orch.resolveUnknown(run.id, nodeId, "did_not_run", KHANEIL), "Recorded as not run; it can be retried.")}>
            It didn't run
          </button>
        </div>
      ))}
      {summary && (summary.unconfigured.length > 0 || summary.waitingOnPerson.length > 0 || summary.held.length > 0) && (
        <ul className="wf-exec-list small">
          {summary.waitingOnPerson.map((w) => (
            <li key={`p-${w.nodeId}`}>
              <b>{names(w.nodeId)}</b> · waiting on you: {w.why}
            </li>
          ))}
          {summary.unconfigured.map((u) => (
            <li key={`u-${u.nodeId}`}>
              <b>{names(u.nodeId)}</b> · unconfigured: {u.need}{" "}
              {run.snapshot.nodes.find((n) => n.id === u.nodeId)?.kind === "agent" && !run.snapshot.nodes.find((n) => n.id === u.nodeId)?.approval && (
                <button className="text-btn small" onClick={() => done(orch.waive(run.id, u.nodeId, "Waived by Khaneil in Workflow Intelligence", KHANEIL), "Step waived.")}>
                  Waive
                </button>
              )}
            </li>
          ))}
          {summary.held.map((h) => (
            <li key={`h-${h.nodeId}`}>
              <b>{names(h.nodeId)}</b> · held: {h.why}
            </li>
          ))}
        </ul>
      )}
      <dl className="wf-exec-report small">
        <dt>Duration</dt>
        <dd>{fmtDur(report.durationMs)}</dd>
        <dt>Steps</dt>
        <dd>
          {report.steps.completed} of {report.steps.total - report.steps.skipped} done · {report.steps.failed} failed · {report.steps.blocked} waiting · {report.steps.awaitingApproval} awaiting approval
        </dd>
        <dt>Retries</dt>
        <dd>{report.retries}</dd>
        <dt>Approvals</dt>
        <dd>
          {report.approvalsGranted} granted · {report.approvalsRejected} rejected
        </dd>
        <dt>Handoffs</dt>
        <dd>
          {report.handoffs.validated} validated · {report.handoffs.unverified} unverified · {report.handoffs.waived} waived · {report.handoffs.invalid} rejected
        </dd>
        <dt>Model use</dt>
        <dd>
          {report.usage.reports ? `${report.usage.inputTokens.toLocaleString()} in / ${report.usage.outputTokens.toLocaleString()} out tokens · $${report.usage.estimatedUsd.toFixed(2)} estimated · $${report.usage.billedUsd.toFixed(2)} billed` : "None reported by a provider"}
        </dd>
        <dt>Artifacts</dt>
        <dd>{report.artifacts.length}</dd>
        <dt>Workflow</dt>
        <dd>{RUN_STATUS_LABEL[report.status]}</dd>
        <dt>Business outcome</dt>
        <dd>{report.outcome === "not_recorded" ? "Not recorded (a finished workflow isn't proof of sales)" : `${report.outcome.replace("_", " ")}${report.outcomeNote ? `: ${report.outcomeNote}` : ""}`}</dd>
      </dl>
      {report.status === "completed" && (
        <div className="wf-outcome">
          <select value={outcome.state} onChange={(e) => setOutcome({ ...outcome, state: e.target.value as typeof outcome.state })} aria-label="Business outcome">
            <option value="too_early">Too early to tell</option>
            <option value="achieved">Achieved</option>
            <option value="not_achieved">Not achieved</option>
          </select>
          <input placeholder="Note" value={outcome.note} onChange={(e) => setOutcome({ ...outcome, note: e.target.value })} />
          <input placeholder="Metric (e.g. orders)" value={outcome.metric} onChange={(e) => setOutcome({ ...outcome, metric: e.target.value })} />
          <input placeholder="Value" inputMode="decimal" value={outcome.value} onChange={(e) => setOutcome({ ...outcome, value: e.target.value })} />
          <input placeholder="Source (e.g. Stripe)" value={outcome.source} onChange={(e) => setOutcome({ ...outcome, source: e.target.value })} />
          <button
            className="btn small"
            onClick={() =>
              done(
                orch.recordOutcome(run.id, { state: outcome.state, note: outcome.note.trim(), metrics: outcome.metric.trim() && outcome.value.trim() ? [{ name: outcome.metric.trim(), value: Number(outcome.value), source: outcome.source.trim() }] : [] }, KHANEIL),
                "Outcome recorded.",
              )
            }
          >
            Record outcome
          </button>
        </div>
      )}
      {msg && <p className="muted small">{msg}</p>}
      <RunIntelligence run={run} tasks={tasks} ledger={ledger} names={names} />
    </div>
  );
}
