import { useState } from "react";
import { CopyValue } from "../../components/bits";
import { canDecide, decide, reviewMemory, useDataOverview, type OverviewState } from "../../data/client";
import { APPROVAL_KIND_LABEL, AREA_LABEL, type ApprovalRow, type DataOverview, type FactTable, type LinkRow, type RunRow } from "../../data/records";
import { relative } from "../../lib/time";
import { formatDateTime } from "../../lib/timezone";
import { MemorySection } from "./MemoryPanels";

// The Atlas database in the Task Center: is it connected, what agents did lately, what waits for
// Khaneil, and the goals, projects and tasks those point at. Read from the site's /api/data; no
// connection string or key is ever shown or sent to the page.

const RUN_CLASS: Record<RunRow["status"], string> = { queued: "idle", running: "active", succeeded: "done", failed: "failed", cancelled: "retired", timed_out: "failed" };
const RUN_LABEL: Record<RunRow["status"], string> = { queued: "Queued", running: "Running", succeeded: "Succeeded", failed: "Failed", cancelled: "Cancelled", timed_out: "Stopped reporting" };
const TABLE_LABEL: Record<FactTable, string> = { goals: "Goal", projects: "Project", tasks: "Task", decisions: "Decision", documents: "Document" };

export function DatabaseCard() {
  const { data, refresh } = useDataOverview();
  return <DatabaseCardView data={data} refresh={refresh} readOnly={!canDecide()} />;
}

/** Split out so the visual checks can show each state without a server. */
export function DatabaseCardView({ data, refresh, onDecide = decide, onReview = reviewMemory, readOnly = false }: { data: OverviewState; refresh: () => void; onDecide?: typeof decide; onReview?: typeof reviewMemory; readOnly?: boolean }) {
  return (
    <section className="card db-card" aria-label="Atlas database">
      <div className="card-head">
        <h3 className="grow">Atlas database</h3>
        <Connection data={data} />
        {data.state !== "off" && (
          <button className="text-btn small" onClick={refresh} disabled={data.state === "loading"}>
            Refresh
          </button>
        )}
      </div>
      <Body data={data} refresh={refresh} onDecide={readOnly ? null : onDecide} onReview={readOnly ? null : onReview} />
    </section>
  );
}

function Connection({ data }: { data: OverviewState }) {
  const [tone, text] =
    data.state === "ready"
      ? ["good", `Connected · schema v${data.value.status.schemaVersion} · ${data.value.status.agentKeys} agent ${data.value.status.agentKeys === 1 ? "key" : "keys"}`]
      : data.state === "loading"
        ? ["", "Checking…"]
        : data.state === "not-configured"
          ? ["bad", "Not set up"]
          : data.state === "off"
            ? ["warn", "Not connected"]
            : ["bad", "Unreachable"];
  return (
    <span className={`task-conn ${tone}`} role="status">
      <span className="dot" /> {text}
    </span>
  );
}

/** `onDecide` is null in the Mac app: it reads the database but approvals are decided on the web page. */
type Decide = typeof decide | null;

function Body({ data, refresh, onDecide, onReview }: { data: OverviewState; refresh: () => void; onDecide: Decide; onReview: typeof reviewMemory | null }) {
  if (data.state === "loading") return <p className="muted small db-pad">Reading the database…</p>;
  if (data.state === "off") return <p className="muted small db-pad">{data.message}</p>;
  if (data.state === "not-configured")
    return (
      <div className="db-pad">
        <p className="muted small">{data.message}</p>
        <p className="muted small">Agent runs, approvals and records show here once the database is connected. Setup steps are in docs/data-foundation.md.</p>
      </div>
    );
  if (data.state === "error")
    return (
      <p className="task-error small db-pad" role="alert">
        {data.message}
      </p>
    );
  return <Ready value={data.value} refresh={refresh} onDecide={onDecide} onReview={onReview} />;
}

function Ready({ value, refresh, onDecide, onReview }: { value: DataOverview; refresh: () => void; onDecide: Decide; onReview: typeof reviewMemory | null }) {
  const [focus, setFocus] = useState<string | null>(null);
  const names = new Map(value.records.map((r) => [r.id, r]));
  const link = (id: string | null, table: FactTable) => {
    if (!id) return null;
    const r = names.get(id);
    return (
      <button key={`${table}-${id}`} className="text-btn inline db-link" onClick={() => setFocus(id)} title={r ? `Show this ${TABLE_LABEL[table].toLowerCase()}` : id}>
        {TABLE_LABEL[table]}: {r ? r.label : `${id.slice(0, 8)}…`}
      </button>
    );
  };
  const { counts } = value;
  return (
    <>
      <div className="db-counts">
        <span>
          <b>{counts.runs24h}</b> runs in 24h
        </span>
        <span className={counts.runsFailed24h ? "bad" : ""}>
          <b>{counts.runsFailed24h}</b> failed
        </span>
        <span className={counts.approvalsPending ? "warn" : ""}>
          <b>{counts.approvalsPending}</b> waiting for you
        </span>
        <span>
          <b>{counts.tasksOpen}</b> open tasks
        </span>
      </div>
      <div className="db-grid">
        <div>
          <div className="section-title">Pending approvals</div>
          {value.approvals.length ? (
            <ul className="list db-list">
              {value.approvals.map((a) => (
                <Approval key={a.id} a={a} link={link} refresh={refresh} onDecide={onDecide} />
              ))}
            </ul>
          ) : (
            <p className="muted small">Nothing is waiting for you.</p>
          )}
        </div>
        <div>
          <div className="section-title">Recent agent runs</div>
          {value.runs.length ? (
            <ul className="list db-list">
              {value.runs.map((r) => (
                <li key={r.id} className="list-row">
                  <span className="grow">
                    <span className="title">{r.agent_id}</span> <span className={`status task-status ${RUN_CLASS[r.status]}`}>{RUN_LABEL[r.status]}</span>
                    <div className="meta" title={formatDateTime(r.started_at)}>
                      {/* The execution number tells two runs of the same workflow apart. */}
                      {r.external_run_id ? `Run #${r.external_run_id} · ` : ""}
                      {relative(r.started_at)}
                      {r.status === "running" || r.status === "timed_out" ? "" : r.finished_at && Date.parse(r.finished_at) > Date.parse(r.started_at) ? ` · took ${Math.max(1, Math.round((Date.parse(r.finished_at) - Date.parse(r.started_at)) / 1000))} s` : ""}
                      {r.attempt && r.attempt > 1 ? ` · attempt ${r.attempt}` : ""}
                      {r.workflow_id ? ` · workflow ${r.workflow_id}` : ""}
                      {r.cost_usd ? ` · $${Number(r.cost_usd).toFixed(4)}` : ""}
                    </div>
                    {(r.error || r.result_summary) && <div className={`db-text ${r.error ? "task-error" : "muted"}`}>{r.error ?? r.result_summary}</div>}
                    <div className="db-links">{[link(r.goal_id, "goals"), link(r.project_id, "projects"), link(r.task_id, "tasks")]}</div>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted small">No agent has recorded a run yet.</p>
          )}
        </div>
        <div>
          <div className="section-title">Goals, projects and recent tasks</div>
          {value.records.length ? (
            <ul className="list db-list">
              {value.records.map((r) => (
                <Record key={r.id} r={r} focused={focus === r.id} />
              ))}
            </ul>
          ) : (
            <p className="muted small">No records yet. Agents and n8n add them through the data API.</p>
          )}
        </div>
      </div>
      {value.memory && <MemorySection memory={value.memory} refresh={refresh} onReview={onReview} />}
    </>
  );
}

function Record({ r, focused }: { r: LinkRow; focused: boolean }) {
  return (
    <li className={`list-row${focused ? " db-focus" : ""}`} ref={(el) => (focused ? el?.scrollIntoView({ block: "nearest", behavior: "smooth" }) : undefined)}>
      <span className="grow">
        <span className="title">{r.label}</span>
        <div className="meta">
          {TABLE_LABEL[r.table]} · {AREA_LABEL[r.area]} · {r.status.replace(/_/g, " ")} · updated {relative(r.updated_at)}
        </div>
        {focused && (
          <div className="meta">
            <CopyValue value={r.id} mono title="Copy the record id" />
          </div>
        )}
      </span>
    </li>
  );
}

function Approval({ a, link, refresh, onDecide }: { a: ApprovalRow; link: (id: string | null, t: FactTable) => React.ReactNode; refresh: () => void; onDecide: Decide }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const act = async (d: "approve" | "reject") => {
    if (!onDecide) return;
    setBusy(true);
    setMessage(null);
    try {
      const r = await onDecide(a.id, d);
      setMessage({ ok: r.ok, text: r.message });
      if (r.ok) refresh();
    } catch (e) {
      setMessage({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <li className="list-row db-approval">
      <span className="grow">
        <span className="title db-wrap">{a.proposed_action}</span>
        <div className="meta">
          {APPROVAL_KIND_LABEL[a.kind]} · {AREA_LABEL[a.area]} · asked by {a.requested_by} {relative(a.created_at)}
          {a.expires_at ? ` · expires ${formatDateTime(a.expires_at)}` : ""}
        </div>
        {a.context && <div className="db-text muted">{a.context}</div>}
        {a.payload && (
          <ul className="db-changes">
            {Object.entries(a.payload.fields).map(([k, v]) => (
              <li key={k}>
                <b>{k.replace(/_/g, " ")}</b> → {v ?? "cleared"}
              </li>
            ))}
          </ul>
        )}
        <div className="db-links">{[link(a.goal_id, "goals"), link(a.project_id, "projects"), link(a.task_id, "tasks"), a.target_table && a.target_id && !(a.target_id === a.task_id || a.target_id === a.project_id || a.target_id === a.goal_id) ? link(a.target_id, a.target_table) : null]}</div>
        {onDecide ? (
          <div className="task-actions">
            <button className="btn small primary" disabled={busy} onClick={() => void act("approve")}>
              Approve
            </button>
            <button className="btn small" disabled={busy} onClick={() => void act("reject")}>
              Reject
            </button>
            {message && <span className={message.ok ? "muted small" : "task-error small"}>{message.text}</span>}
          </div>
        ) : (
          <div className="meta">Approve or reject this on the Atlas web page.</div>
        )}
      </span>
    </li>
  );
}
