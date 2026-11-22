import { useMemo, useState } from "react";
import { decide } from "../../data/client";
import { useAtlas } from "../../state";
import { formatDateTime } from "../../lib/timezone";
import { canControl, checkNow, goalAction, submitGoal, summariseControl, useExecutiveControl, type ControlAction } from "../../executive/control/client";
import { AUTONOMY_LABEL, GOAL_STATE_LABEL, REPORT_SECTION_LABEL, REPORT_SECTIONS, RUN_LIMITS, TERMINAL_GOAL_STATES, type ApprovalView, type EventView, type ExecutiveOverview, type GoalView, type TaskView } from "../../executive/control/types";
import "../../styles/executive.css";

// Mission Control > Atlas Executive. Everything here comes from the Atlas database through the
// site's /api/executive routes: goals, plans, tasks, approvals, verified results, costs and the
// event timeline. The browser never calls n8n or a model; the server engine does the work.

const VERTICAL_SLICE = "Research one potential Benjaire AI automation product and prepare a structured opportunity report.";

const TASK_STATE_LABEL: Record<TaskView["state"], string> = {
  pending: "Waiting on earlier steps",
  ready: "Ready",
  blocked: "Blocked",
  awaiting_approval: "Waiting for approval",
  dispatching: "Sending",
  running: "Running",
  verifying: "Checking",
  completed: "Done",
  failed: "Failed",
  cancelled: "Cancelled",
};

const tone = (s: string) =>
  s === "GOAL_COMPLETED" || s === "completed" ? "good" : s === "FAILED" || s === "failed" ? "bad" : s === "BLOCKED" || s === "blocked" || s === "AWAITING_APPROVAL" || s === "awaiting_approval" || s === "PAUSED" ? "warn" : "";
const usd = (n: number) => `$${n.toFixed(2)}`;

export function ExecutiveControl() {
  const { data, refresh } = useExecutiveControl();
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<{ ok: boolean; message: string }>) => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await fn();
      setMsg(r.ok ? null : r.message);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      refresh();
    }
  };

  return (
    <section className="card exec-ctl" aria-label="Atlas Executive">
      <div className="card-head exec-head">
        <h2 className="grow">Atlas Executive</h2>
        {data.state === "ready" && <span className="muted small">{summariseControl(data.value).line}</span>}
        {data.state === "ready" && canControl() && (
          <button className="btn small" disabled={busy} onClick={() => run(() => checkNow())}>
            Check now
          </button>
        )}
      </div>
      <p className="muted small exec-pad">
        Atlas Headquarters' orchestrator. Give it a goal; it plans from a fixed template, assigns registered agents, runs outside work through n8n and only marks a goal done after Atlas checks the result. Level 4 actions always wait for you.
      </p>
      {msg && <p className="task-error exec-pad">{msg}</p>}
      {data.state === "loading" && <p className="muted small exec-pad">Loading…</p>}
      {(data.state === "off" || data.state === "not-configured" || data.state === "error") && <p className={`small exec-pad ${data.state === "error" ? "task-error" : "muted"}`}>{data.message}</p>}
      {data.state === "ready" && <Ready o={data.value} busy={busy} run={run} />}
    </section>
  );
}

function Ready({ o, busy, run }: { o: ExecutiveOverview; busy: boolean; run: (fn: () => Promise<{ ok: boolean; message: string }>) => void }) {
  const s = useMemo(() => summariseControl(o), [o]);
  const [open, setOpen] = useState<string | null>(s.open[0]?.id ?? null);
  const editable = canControl();
  return (
    <>
      {o.emergencyStop && <p className="task-error exec-pad">{o.emergencyStop}. Nothing new is sent until it is turned off.</p>}
      {!o.configured.n8n && <p className="muted small exec-pad">The n8n dispatch keys aren't set on the site, so tasks wait at "Ready" and nothing is sent.</p>}
      <div className="exec-kpis exec-pad">
        <Kpi label="Open goals" value={s.open.length} />
        <Kpi label="Tasks running" value={s.running} />
        <Kpi label="Waiting for you" value={s.awaitingApproval} warn={s.awaitingApproval > 0} />
        <Kpi label="Blocked" value={s.blocked} warn={s.blocked > 0} />
        <Kpi label="Verified results" value={s.verified} />
        <Kpi label="Spent today" value={usd(o.spend.todayUsd)} sub={`${o.spend.dispatchesToday} of ${o.spend.dailyCap} dispatches`} />
      </div>
      {editable && <NewGoal busy={busy} run={run} openGoals={s.open.length} />}
      <div className="exec-grid">
        <div className="exec-col">
          <h3 className="exec-h">Goals</h3>
          {o.goals.length === 0 && <p className="muted small">No goals yet.</p>}
          {o.goals.map((g) => (
            <Goal key={g.id} g={g} open={open === g.id} toggle={() => setOpen(open === g.id ? null : g.id)} events={o.events.filter((e) => e.goalId === g.id)} busy={busy} run={run} editable={editable} />
          ))}
        </div>
        <div className="exec-col">
          <h3 className="exec-h">Approvals</h3>
          <Approvals list={o.approvals} goals={o.goals} busy={busy} run={run} editable={editable} />
          <h3 className="exec-h">Latest events</h3>
          <Timeline events={o.events.slice(0, 12)} />
        </div>
      </div>
    </>
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

function NewGoal({ busy, run, openGoals }: { busy: boolean; run: (fn: () => Promise<{ ok: boolean; message: string }>) => void; openGoals: number }) {
  const [objective, setObjective] = useState("");
  const [budget, setBudget] = useState(String(RUN_LIMITS.defaultBudgetUsd));
  const [autonomy, setAutonomy] = useState("2");
  return (
    <form
      className="exec-form task-form"
      onSubmit={(e) => {
        e.preventDefault();
        run(async () => {
          const r = await submitGoal(objective.trim(), Number(budget) || null, Number(autonomy) || null);
          if (r.ok) setObjective("");
          return r;
        });
      }}
    >
      <div className="chips">
        <button type="button" className="chip" onClick={() => setObjective(VERTICAL_SLICE)}>
          {VERTICAL_SLICE}
        </button>
      </div>
      <label className="task-field">
        <span>Goal</span>
        <textarea rows={2} maxLength={500} value={objective} onChange={(e) => setObjective(e.target.value)} placeholder="What should Atlas get done?" />
      </label>
      <div className="task-row">
        <label className="task-field">
          <span>Budget (USD, at most {RUN_LIMITS.maxBudgetUsd})</span>
          <input type="number" min={0.1} max={RUN_LIMITS.maxBudgetUsd} step={0.1} value={budget} onChange={(e) => setBudget(e.target.value)} />
        </label>
        <label className="task-field">
          <span>Autonomy</span>
          <select value={autonomy} onChange={(e) => setAutonomy(e.target.value)}>
            {([1, 2, 3] as const).map((l) => (
              <option key={l} value={l}>
                {AUTONOMY_LABEL[l]}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="exec-actions">
        <span className="muted small grow">{openGoals} of 5 goals open. Nothing runs that Atlas can't check.</span>
        <button className="btn small primary" type="submit" disabled={busy || objective.trim().length < 12}>
          Start goal
        </button>
      </div>
    </form>
  );
}

function Goal({ g, open, toggle, events, busy, run, editable }: { g: GoalView; open: boolean; toggle: () => void; events: EventView[]; busy: boolean; run: (fn: () => Promise<{ ok: boolean; message: string }>) => void; editable: boolean }) {
  const { setView } = useAtlas();
  const closed = TERMINAL_GOAL_STATES.has(g.state);
  const act = (a: ControlAction) => run(() => goalAction(g.id, a));
  const report = g.tasks.find((t) => t.artifact?.verification?.passed)?.artifact?.report ?? null;
  return (
    <div className="exec-goal">
      <button className="exec-goal-top" onClick={toggle} aria-expanded={open}>
        <span className="exec-goal-title">{g.objective}</span>
        <span className="exec-goal-meta">
          <span className={`chip ${tone(g.state)}`}>{GOAL_STATE_LABEL[g.state]}</span>
          <span className="muted small">
            {usd(g.spentUsd)} of {usd(g.budgetUsd)} · {AUTONOMY_LABEL[g.autonomy]} · {formatDateTime(g.createdAt)}
          </span>
        </span>
      </button>
      {open && (
        <div className="exec-goal-body">
          {g.stateReason && <p className="small">{g.stateReason}</p>}
          {g.planProblems.length > 0 && (
            <ul className="small exec-problems">
              {g.planProblems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          )}
          {g.plan && (
            <details>
              <summary className="small">
                Plan: {g.plan.template} · {g.plan.tasks.length} tasks · up to {usd(g.plan.estimatedCostUsd)}
              </summary>
              <ol className="exec-steps small">
                {g.plan.tasks.map((t) => (
                  <li key={t.key}>
                    <b>{t.title}</b> ({t.capability}){t.dependsOn.length ? ` after ${t.dependsOn.join(", ")}` : ""}. {t.acceptance}
                  </li>
                ))}
              </ol>
            </details>
          )}
          <div className="exec-graph" aria-label="Execution graph">
            {g.tasks.map((t, i) => (
              <span key={t.id} className="exec-node-wrap">
                {i > 0 && <span className="exec-arrow" aria-hidden="true">→</span>}
                <Task t={t} />
              </span>
            ))}
          </div>
          {report && (
            <details open>
              <summary className="small">Verified report: {report.productName}</summary>
              {REPORT_SECTIONS.map((k) => (
                <div key={k} className="exec-section">
                  <div className="exec-h">{REPORT_SECTION_LABEL[k]}</div>
                  <p className="small">
                    {report.sections[k]?.text} {report.sections[k]?.sources.map((s) => `[${s}]`).join(" ")}
                  </p>
                </div>
              ))}
              <ol className="small exec-sources">
                {report.sources.map((s) => (
                  <li key={s.id}>
                    [{s.id}]{" "}
                    <a href={s.url} target="_blank" rel="noreferrer noopener">
                      {s.title}
                    </a>
                  </li>
                ))}
              </ol>
            </details>
          )}
          {g.summary && !report && <p className="small">{g.summary}</p>}
          <details>
            <summary className="small">History ({events.length})</summary>
            <Timeline events={events} />
          </details>
          <div className="exec-actions">
            <button className="btn small" onClick={() => setView("tasks")}>
              Task Center
            </button>
            <button className="btn small" onClick={() => setView("workflows")}>
              Workflow Intelligence
            </button>
            <span className="grow" />
            {editable && !closed && (
              <>
                {g.state === "PAUSED" ? (
                  <button className="btn small" disabled={busy} onClick={() => act("resume")}>
                    Resume
                  </button>
                ) : (
                  <button className="btn small" disabled={busy} onClick={() => act("pause")}>
                    Pause
                  </button>
                )}
                <button className="btn small" disabled={busy} onClick={() => act("cancel")}>
                  Cancel goal
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Task({ t }: { t: TaskView }) {
  const v = t.artifact?.verification;
  return (
    <span className={`exec-node ${tone(t.state)}`}>
      <b>{t.title}</b>
      <span className="small">{TASK_STATE_LABEL[t.state]}{t.attempts ? ` · attempt ${t.attempts} of ${t.maxAttempts}` : ""}</span>
      <span className="muted small">
        {t.agentName ?? t.agentId ?? "No agent yet"}
        {t.workflow ? ` · ${t.workflow}` : ""}
        {t.costUsd ? ` · ${usd(t.costUsd)}` : ""}
      </span>
      {(t.blockedReason || t.error) && <span className="small exec-why">{t.blockedReason ?? t.error}</span>}
      {v && <span className="muted small">{v.passed ? `Checked: ${v.checks.length} checks passed` : `Checks failed: ${v.checks.filter((c) => !c.passed).map((c) => c.name).join(", ")}`}</span>}
    </span>
  );
}

function Approvals({ list, goals, busy, run, editable }: { list: ApprovalView[]; goals: GoalView[]; busy: boolean; run: (fn: () => Promise<{ ok: boolean; message: string }>) => void; editable: boolean }) {
  const pending = list.filter((a) => a.status === "pending");
  if (!pending.length) return <p className="muted small">Nothing waiting for you.</p>;
  return (
    <ul className="list exec-box">
      {pending.map((a) => {
        const goal = goals.find((g) => g.goalRecordId === a.goalId);
        return (
          <li key={a.id} className="list-row">
            <div className="grow">
              <div className="title">{a.action}</div>
              <div className="meta">
                {goal ? goal.objective : a.target} · expires {a.expiresAt ? formatDateTime(a.expiresAt) : "never"}
              </div>
            </div>
            {editable && (
              <div className="exec-actions">
                <button className="btn small primary" disabled={busy} onClick={() => run(async () => { const r = await decide(a.id, "approve"); if (r.ok && goal) await goalAction(goal.id, "advance"); return r; })}>
                  Approve
                </button>
                <button className="btn small" disabled={busy} onClick={() => run(async () => { const r = await decide(a.id, "reject"); if (r.ok && goal) await goalAction(goal.id, "advance"); return r; })}>
                  Reject
                </button>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function Timeline({ events }: { events: EventView[] }) {
  if (!events.length) return <p className="muted small">No events yet.</p>;
  return (
    <ul className="list exec-box exec-timeline">
      {events.map((e) => (
        <li key={e.id} className="list-row">
          <div className="grow">
            <div className="small">
              <b>{e.kind}</b>
              {e.toState ? ` → ${e.toState}` : ""} · {e.actor}
            </div>
            {e.detail && <div className="meta">{e.detail}</div>}
          </div>
          <span className="muted small">{formatDateTime(e.at)}</span>
        </li>
      ))}
    </ul>
  );
}
