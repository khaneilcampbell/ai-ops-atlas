import "../../styles/intelligence.css";
import { useEffect, useState } from "react";
import { spend } from "../../execution/policy";
import type { RunLedger } from "../../execution/types";
import { useIntel } from "../../intelligence/app";
import { recordRunIntelligence } from "../../intelligence/benjaire";
import { reviewDecision } from "../../intelligence/decisions";
import { TIER_LABEL } from "../../intelligence/routing";
import { MEMORY_LABEL } from "../../intelligence/types";
import { useAtlas } from "../../state";
import { KHANEIL, type StoredTask } from "../../tasks/types";
import type { WorkflowRun } from "../../workflows/types";

// Workflow Intelligence → a live run's evidence: per step, the knowledge it was given (with
// sources and verification), its evaluation and reported AI usage; plus the decision summaries
// agents recorded for the run, with Khaneil's review where one is needed.

export function RunIntelligence({ run, tasks, ledger, names }: { run: WorkflowRun; tasks: ReadonlyMap<string, StoredTask>; ledger: RunLedger; names: (id: string) => string }) {
  const { catalog } = useAtlas();
  const { store, file } = useIntel(catalog);
  const [msg, setMsg] = useState<string | null>(null);

  // Findings and evaluations are recorded after every change to the run. Idempotent.
  useEffect(() => {
    recordRunIntelligence(store, run, ledger, tasks);
  }, [store, run, ledger, tasks]);

  const contexts = file.contexts.filter((c) => c.runId === run.id);
  const evals = file.evaluations.filter((e) => e.runId === run.id);
  const decisions = file.decisions.filter((d) => d.runId === run.id);
  const steps = run.snapshot.nodes.filter((n) => n.agentId && run.nodeTasks[n.id]);

  return (
    <div className="wf-intel">
      <div className="section-title">Evidence and evaluation</div>
      <table className="intel-table small">
        <thead>
          <tr>
            <th>Step</th>
            <th>Knowledge used</th>
            <th>Model route</th>
            <th>Score</th>
            <th>AI usage</th>
          </tr>
        </thead>
        <tbody>
          {steps.map((n) => {
            const ctx = contexts.filter((c) => c.nodeId === n.id).pop();
            const ev = evals.filter((e) => e.nodeId === n.id).pop();
            const t = tasks.get(run.nodeTasks[n.id]);
            const s = t ? spend(t) : null;
            return (
              <tr key={n.id}>
                <td className="intel-step">{names(n.id)}</td>
                <td data-label="Knowledge">
                  {ctx ? (
                    <details>
                      <summary>
                        {ctx.items.length} item{ctx.items.length === 1 ? "" : "s"} · {ctx.usedTokens}/{ctx.budgetTokens} tokens
                      </summary>
                      <ul className="reg-list compact">
                        {ctx.items.map((i) => (
                          <li key={i.id}>
                            {i.title} <span className="muted">· {MEMORY_LABEL[i.category]} · {i.verification}{i.stale ? " · stale" : ""} · {i.source.ref}</span>
                          </li>
                        ))}
                      </ul>
                    </details>
                  ) : (
                    <span className="muted">Not sent yet</span>
                  )}
                </td>
                <td data-label="Route">{ctx ? `${TIER_LABEL[ctx.route.tier]}${ctx.route.model ? ` · ${ctx.route.model}` : ""}` : "—"}</td>
                <td data-label="Score" title={ev?.flags.join("\n")}>
                  {ev ? (ev.score ?? "—") : <span className="muted">Not finished</span>}
                  {ev?.flags.length ? <span className="count-pill warn">{ev.flags.length}</span> : null}
                </td>
                <td data-label="AI usage">{s && s.reports ? `${(s.inputTokens + s.outputTokens).toLocaleString()} tokens · $${s.estimatedUsd.toFixed(3)} est · $${s.billedUsd.toFixed(3)} billed` : <span className="muted">None reported</span>}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <div className="section-title">Decision summaries</div>
      {decisions.length ? (
        <ul className="list">
          {decisions.map((d) => (
            <li key={d.id} className="list-row">
              <span className="grow">
                <b>{d.recommendation}</b>
                <div className="meta">
                  {catalog.agents.find((a) => a.id === d.agentId)?.name ?? d.agentId} · {d.confidence} confidence · {d.impact} impact · {d.evidence.length} evidence ({d.evidence.filter((e) => e.verification === "verified").length} verified)
                </div>
                {d.uncertainties.length > 0 && <div className="meta">Uncertain: {d.uncertainties.join("; ")}</div>}
                {d.alternatives.length > 0 && <div className="meta">Alternatives: {d.alternatives.join("; ")}</div>}
                {d.requiredApprovals.length > 0 && <div className="meta">Needs: {d.requiredApprovals.join("; ")}</div>}
              </span>
              {d.review === "pending" ? (
                <span className="row-actions">
                  <button className="btn small" onClick={() => setMsg(reviewDecision(store, d.id, KHANEIL, "approved").ok ? "Approved." : "Not saved.")}>
                    Approve
                  </button>
                  <button className="btn small" onClick={() => setMsg(reviewDecision(store, d.id, KHANEIL, "rejected").ok ? "Rejected." : "Not saved.")}>
                    Reject
                  </button>
                </span>
              ) : (
                <span className="chip">{d.review === "not_needed" ? "No review needed" : d.review}</span>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted small">No recommendations recorded for this run yet.</p>
      )}
      {msg && <p className="muted small">{msg}</p>}
    </div>
  );
}
