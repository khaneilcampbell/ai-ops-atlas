import "../../styles/tasks.css";
import { useState } from "react";
import { reviewMemory, useAgentMemory, type AgentMemoryState } from "../../data/client";
import { confidenceOf, DECISION_LABEL, MEMORY_CATEGORY_LABEL, MEMORY_KIND_LABEL, PREPARE_DECISIONS, type AgentMemory, type MemoryOverview, type MemoryRow } from "../../data/memory";
import { relative } from "../../lib/time";
import { formatDateTime } from "../../lib/timezone";

// Agent memory from the Atlas database (migration 0003): in the Task Center's database card (what
// waits for Khaneil to verify, what the pre-run checks decided and saved) and on each agent's
// Operations tab (its memory, verified procedures, runs, related jobs and performance). Read-only
// except Verify / Wrong / Retire, which only the web page offers.

const STATUS_LABEL: Record<string, string> = { queued: "Queued", running: "Running", succeeded: "Succeeded", failed: "Failed", cancelled: "Cancelled", timed_out: "Stopped reporting" };
const STATUS_CLASS: Record<string, string> = { queued: "idle", running: "active", succeeded: "done", failed: "failed", cancelled: "retired", timed_out: "failed" };
const VERDICT_LABEL: Record<string, string> = { passed: "checks passed", partial: "some checks failed", failed: "checks failed", unverified: "not checked" };

const tokens = (n: number) => (n >= 10_000 ? `${Math.round(n / 1000)}k` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));
const duration = (ms: number | null) => (ms == null ? null : ms < 60_000 ? `${Math.round(ms / 1000)} s` : `${Math.round(ms / 60_000)} min`);

/** How much to trust it and how fresh it is, in words. */
export function trustLine(m: MemoryRow, now = Date.now()): string {
  const c = confidenceOf(m, now);
  const stale = !!m.review_at && Date.parse(m.review_at) <= now;
  const level = c >= 0.8 ? "high confidence" : c >= 0.45 ? "medium confidence" : "low confidence";
  return `${m.verification === "verified" ? `verified${m.verified_by ? ` by ${m.verified_by}` : ""}` : m.verification === "disputed" ? "marked wrong" : "not verified"} · ${level} · ${stale ? "due for review" : `updated ${relative(m.updated_at)}`}${m.use_count ? ` · used ${m.use_count}×` : ""}`;
}

function Source({ m }: { m: MemoryRow }) {
  const label = `${m.source_kind}: ${m.source_ref}`;
  return m.source_url ? (
    <a href={m.source_url} target="_blank" rel="noreferrer" className="db-link">
      {label}
    </a>
  ) : (
    <span>{label}</span>
  );
}

function MemoryItem({ m, onReview, refresh }: { m: MemoryRow; onReview: typeof reviewMemory | null; refresh?: () => void }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const act = async (a: "verify" | "dispute" | "retire") => {
    if (!onReview) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await onReview(m.id, a);
      setMsg({ ok: r.ok, text: r.message });
      if (r.ok) refresh?.();
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <li className="list-row">
      <span className="grow">
        <span className="title db-wrap">{m.title}</span>
        <div className="meta">
          {MEMORY_KIND_LABEL[m.kind]} · {MEMORY_CATEGORY_LABEL[m.category]} · {trustLine(m)}
        </div>
        <div className="db-text muted">{m.content}</div>
        <div className="db-links">
          <Source m={m} />
          {m.task_key && <span className="mono">{m.task_key}</span>}
          {m.error_class && <span className="mono">{m.error_class}</span>}
          {m.created_by !== "owner" && <span>from {m.created_by}</span>}
        </div>
        {m.suspicious && <div className="task-error small">Held from agents: {m.suspicious}</div>}
        {onReview && m.verification === "unverified" && (
          <div className="task-actions">
            <button className="btn small primary" disabled={busy} onClick={() => void act("verify")}>
              Verify
            </button>
            <button className="btn small" disabled={busy} onClick={() => void act("dispute")}>
              Wrong
            </button>
            <button className="btn small" disabled={busy} onClick={() => void act("retire")}>
              Retire
            </button>
            {msg && <span className={msg.ok ? "muted small" : "task-error small"}>{msg.text}</span>}
          </div>
        )}
      </span>
    </li>
  );
}

/** The Task Center database card's memory row: counts, what pre-run checks decided, and what waits for review. */
export function MemorySection({ memory, refresh, onReview }: { memory: MemoryOverview; refresh: () => void; onReview: typeof reviewMemory | null }) {
  const decided = PREPARE_DECISIONS.filter((d) => memory.decisions30d[d]);
  return (
    <div className="db-memory">
      <div className="section-title">Agent memory</div>
      <div className="db-counts">
        <span>
          <b>{memory.counts.live}</b> memories
        </span>
        <span>
          <b>{memory.counts.verified}</b> verified
        </span>
        <span className={memory.counts.unverified ? "warn" : ""}>
          <b>{memory.counts.unverified}</b> to check
        </span>
        <span>
          <b>{memory.counts.procedures}</b> trusted procedures
        </span>
        <span title="Estimated from the tokens earlier runs of the same jobs used. Not billed amounts.">
          <b>~{tokens(memory.tokensSaved30d)}</b> tokens saved in 30 days (estimate)
        </span>
        <span className={memory.runsTimedOut ? "bad" : ""}>
          <b>{memory.runsTimedOut}</b> runs stopped reporting
        </span>
      </div>
      {decided.length > 0 && (
        <p className="muted small db-pad">
          Before running, agents checked memory: {decided.map((d) => `${DECISION_LABEL[d].toLowerCase()} ${memory.decisions30d[d]}`).join(" · ")} (last 30 days).
        </p>
      )}
      {memory.toReview.length ? (
        <ul className="list db-list db-pad-list">
          {memory.toReview.map((m) => (
            <MemoryItem key={m.id} m={m} onReview={onReview} refresh={refresh} />
          ))}
        </ul>
      ) : (
        <p className="muted small db-pad">No agent lesson or procedure is waiting for you to check. Agents can propose them, but only you can make one trusted.</p>
      )}
    </div>
  );
}

/** Agent page → Operations: what the database remembers about this agent. */
export function AgentMemoryPanel({ agentId }: { agentId: string }) {
  return <AgentMemoryView data={useAgentMemory(agentId)} />;
}

export function AgentMemoryView({ data }: { data: AgentMemoryState }) {
  return (
    <section className="agent-memory" aria-label="Memory and run history">
      <div className="section-title">Memory and run history</div>
      {data.state === "loading" ? (
        <p className="muted small">Reading the Atlas database…</p>
      ) : data.state === "off" ? (
        <p className="muted small">{data.message}</p>
      ) : data.state === "error" ? (
        <p className="task-error small" role="alert">
          {data.message}
        </p>
      ) : (
        <AgentMemoryBody value={data.value} />
      )}
    </section>
  );
}

function AgentMemoryBody({ value }: { value: AgentMemory }) {
  const p = value.performance;
  const procedures = value.memory.filter((m) => m.kind === "procedure" && m.verification === "verified");
  const rest = value.memory.filter((m) => !procedures.includes(m));
  if (!value.runs.length && !value.memory.length) return <p className="muted small">The database has no runs or memory for this agent yet. They appear once it records runs through the data API.</p>;
  return (
    <>
      <div className="db-counts flush">
        <span>
          <b>{p.runs30d}</b> runs in 30 days
        </span>
        <span>
          <b>{p.succeeded30d}</b> succeeded
        </span>
        <span className={p.failed30d + p.timedOut30d ? "bad" : ""}>
          <b>{p.failed30d + p.timedOut30d}</b> failed or stopped
        </span>
        <span>
          <b>{p.passedChecks30d}</b> passed their checks
        </span>
        {p.medianDurationMs != null && (
          <span>
            <b>{duration(p.medianDurationMs)}</b> typical run
          </span>
        )}
        {p.costUsd30d > 0 && (
          <span>
            <b>${p.costUsd30d.toFixed(2)}</b> spent
          </span>
        )}
        <span title="Repeat work Atlas stopped before it ran (skips, waits, existing tasks), and the tokens those runs used before. An estimate.">
          <b>{p.duplicatesPrevented30d}</b> repeats avoided · ~{tokens(p.tokensSaved30d)} tokens saved
        </span>
      </div>
      {procedures.length > 0 && (
        <>
          <div className="section-title">Verified procedures</div>
          <ul className="list db-list">
            {procedures.map((m) => (
              <MemoryItem key={m.id} m={m} onReview={null} />
            ))}
          </ul>
        </>
      )}
      <div className="section-title">Memory</div>
      {rest.length ? (
        <ul className="list db-list">
          {rest.map((m) => (
            <MemoryItem key={m.id} m={m} onReview={null} />
          ))}
        </ul>
      ) : (
        <p className="muted small">Nothing remembered yet.</p>
      )}
      <div className="section-title">Recent runs</div>
      {value.runs.length ? (
        <ul className="list db-list">
          {value.runs.map((r) => (
            <li key={r.id} className="list-row">
              <span className="grow">
                <span className="title">{r.external_run_id ? `Run #${r.external_run_id}` : `Run ${r.id.slice(0, 8)}`}</span> <span className={`status task-status ${STATUS_CLASS[r.status]}`}>{STATUS_LABEL[r.status]}</span>
                <div className="meta" title={formatDateTime(r.started_at)}>
                  {relative(r.started_at)}
                  {r.attempt > 1 ? ` · attempt ${r.attempt}` : ""}
                  {r.verdict ? ` · ${VERDICT_LABEL[r.verdict]}` : ""}
                  {r.quality_score != null ? ` · quality ${r.quality_score}/100` : ""}
                  {duration(r.duration_ms) ? ` · ${duration(r.duration_ms)}` : ""}
                  {r.task_key ? ` · ${r.task_key}` : ""}
                </div>
                {(r.error || r.result_summary) && <div className={`db-text ${r.error ? "task-error" : "muted"}`}>{r.error ?? r.result_summary}</div>}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted small">No runs recorded.</p>
      )}
      {value.related.length > 0 && (
        <>
          <div className="section-title">Related jobs</div>
          <ul className="list db-list">
            {value.related.map((j) => (
              <li key={j.taskKey} className="list-row">
                <span className="grow">
                  <span className="title mono db-wrap">{j.taskKey}</span>
                  <div className="meta">
                    {j.runs} {j.runs === 1 ? "run" : "runs"} · last {STATUS_LABEL[j.lastStatus].toLowerCase()} {relative(j.lastAt)}
                  </div>
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}
