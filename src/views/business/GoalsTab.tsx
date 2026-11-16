import { useState } from "react";
import { Icon } from "../../components/Icon";
import { useAtlas } from "../../state";
import { useTasks } from "../../tasks/store";
import { useRuns } from "../../workflows/runs";
import { focusWorkflowRun } from "../../workflows/selection";
import { addEvidence, confirmGoal, draftGoal, GOAL_TEMPLATES, goalProgress, linkRun, METRIC_INFO, metricValue, type GoalProgress } from "../../business/goals";
import { businessStore } from "../../business/store";
import { money } from "../../business/revenue";
import { GOAL_DOMAINS, GOAL_METRICS, type BusinessData, type BusinessGoal, type EvidenceRef, type GoalDomain, type GoalMetric } from "../../business/types";
import type { BusinessFilter, Overview } from "../../business/dashboard";
import { DOMAIN_LABEL, Empty, ErrorLine, Field, ME, nowIso, Panel, pct, ProvChip, today } from "./parts";

const VERDICT: Record<GoalProgress["verdict"], { label: string; cls: string }> = {
  achieved: { label: "Achieved", cls: "done" },
  met_unconfirmed: { label: "Target met, confirm it", cls: "attention" },
  on_track: { label: "On track", cls: "active" },
  at_risk: { label: "At risk", cls: "paused" },
  missed: { label: "Missed", cls: "failed" },
  unmeasured: { label: "Not measurable yet", cls: "idle" },
  draft: { label: "Draft", cls: "idle" },
  cancelled: { label: "Cancelled", cls: "retired" },
};

export function fmtMetric(goal: Pick<BusinessGoal, "metric" | "currency">, v: number | null): string {
  if (v === null) return "Not measured";
  const u = METRIC_INFO[goal.metric].unit;
  if (u === "money") return money(v, goal.currency ?? "USD");
  if (u === "usd") return `$${v.toFixed(4).replace(/0+$/, "").replace(/\.$/, "")}`;
  if (u === "hours") return `${v} h`;
  return String(v);
}

/** Two separate lines: the work done in linked workflows, and the business result. */
export function GoalBars({ goal, p, compact = false, onOpen }: { goal: BusinessGoal; p: GoalProgress; compact?: boolean; onOpen?: () => void }) {
  const v = VERDICT[p.verdict];
  return (
    <div className={`biz-goal${compact ? " compact" : ""}`}>
      <div className="biz-goal-head">
        {onOpen ? <button className="text-btn inline name" onClick={onOpen}>{goal.title}</button> : <b>{goal.title}</b>}
        <ProvChip p={goal.provenance} />
        <span className={`status task-status ${v.cls}`}>{v.label}</span>
        <span className="muted small">due {goal.targetDate}</span>
      </div>
      <div className="biz-goal-lines">
        <div><span className="muted small">Business result · {METRIC_INFO[goal.metric].label}</span><div className="biz-meter outcome"><span style={{ width: `${(p.outcome ?? 0) * 100}%` }} /></div><small>{fmtMetric(goal, p.current)} of {fmtMetric(goal, goal.target)} (from {fmtMetric(goal, goal.baseline)})</small></div>
        <div><span className="muted small">Workflow work done</span><div className="biz-meter work"><span style={{ width: `${(p.work ?? 0) * 100}%` }} /></div><small>{p.work === null ? "No workflow runs linked" : `${p.workDone} of ${p.workTotal} steps · ${pct(p.work)}`}</small></div>
      </div>
      {!compact && <p className="muted small biz-goal-note">{p.note}</p>}
    </div>
  );
}

export function GoalsTab({ o, data, filter, agentName }: { o: Overview; data: BusinessData; filter: BusinessFilter; agentName: (id: string) => string }) {
  const [form, setForm] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const goal = data.goals.find((g) => g.id === open);
  return (
    <>
      <div className="biz-actions-row">
        <p className="muted small">A goal is achieved only when its business metric reaches the target in real records and you confirm it with evidence. Finished workflows show as work done, never as the result.</p>
        <button className="btn primary" onClick={() => setForm(true)}><Icon name="plus" size={14} /> New goal</button>
      </div>
      {o.goals.length ? (
        <div className="card card-pad biz-goal-list">{o.goals.map(({ goal: g, progress }) => <GoalBars key={g.id} goal={g} p={progress} onOpen={() => setOpen(g.id)} />)}</div>
      ) : (
        <Empty title="No goals yet"><p className="muted">Start from one of the suggested goals (first product launched, first paying customer, more qualified leads, faster replies, lower AI cost per task) or write your own.</p></Empty>
      )}
      {form && <GoalForm data={data} filter={filter} onClose={() => setForm(false)} />}
      {goal && <GoalDetail goal={goal} data={data} agentName={agentName} onClose={() => setOpen(null)} />}
    </>
  );
}

function GoalForm({ data, filter, onClose }: { data: BusinessData; filter: BusinessFilter; onClose: () => void }) {
  const tasks = useTasks();
  const runs = useRuns();
  const { catalog } = useAtlas();
  const [title, setTitle] = useState("");
  const [domain, setDomain] = useState<GoalDomain>("revenue");
  const [outcome, setOutcome] = useState("");
  const [metric, setMetric] = useState<GoalMetric>("net_revenue");
  const [currency, setCurrency] = useState("USD");
  const [baseline, setBaseline] = useState("0");
  const [target, setTarget] = useState("");
  const [start, setStart] = useState(today());
  const [due, setDue] = useState("");
  const [agents, setAgents] = useState<string[]>([]);
  const [approval, setApproval] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const testMode = filter.provenance === "test";

  const current = (m: GoalMetric, cur = currency) => metricValue({ metric: m, startDate: "0000-01-01", targetDate: today(), currency: cur }, { data, tasks, runs });
  const pick = (i: number) => {
    const t = GOAL_TEMPLATES[i];
    setTitle(t.title); setDomain(t.domain); setOutcome(t.targetOutcome); setMetric(t.metric); setTarget(String(t.target));
    const c = current(t.metric);
    setBaseline(c === null ? "" : String(t.metric === "net_revenue" ? c / 100 : c));
  };
  const submit = () => {
    const isMoney = METRIC_INFO[metric].unit === "money";
    const b = Number(baseline), t = Number(target);
    const r = draftGoal({ title, domain, targetOutcome: outcome, metric, currency: currency.toUpperCase(), baseline: isMoney ? Math.round(b * 100) : b, target: isMoney ? Math.round(t * 100) : t, startDate: start, targetDate: due, agentIds: agents, requiresApproval: approval, provenance: testMode ? "test" : "real" }, ME, nowIso());
    if (!r.ok) return setError(r.error);
    const s = businessStore().create("goals", r.value);
    if (!s.ok) return setError(s.error);
    onClose();
  };
  return (
    <Panel title="New business goal" onClose={onClose}>
      <Field label="Start from a suggestion">
        <select defaultValue="" onChange={(e) => e.target.value !== "" && pick(Number(e.target.value))}>
          <option value="">Choose…</option>
          {GOAL_TEMPLATES.map((t, i) => <option key={t.title} value={i}>{t.title}</option>)}
        </select>
      </Field>
      <Field label="Title"><input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={140} /></Field>
      <Field label="Target outcome"><input value={outcome} onChange={(e) => setOutcome(e.target.value)} placeholder="What the business result looks like" /></Field>
      <div className="task-row">
        <Field label="Business area"><select value={domain} onChange={(e) => setDomain(e.target.value as GoalDomain)}>{GOAL_DOMAINS.map((d) => <option key={d} value={d}>{DOMAIN_LABEL[d]}</option>)}</select></Field>
        <Field label="Measured by"><select value={metric} onChange={(e) => setMetric(e.target.value as GoalMetric)}>{GOAL_METRICS.map((m) => <option key={m} value={m}>{METRIC_INFO[m].label}</option>)}</select></Field>
      </div>
      <div className="task-row">
        <Field label={`Baseline${METRIC_INFO[metric].unit === "money" ? ` (${currency})` : ""}`} hint="Filled from your records when there are any"><input inputMode="decimal" value={baseline} onChange={(e) => setBaseline(e.target.value)} /></Field>
        <Field label="Target"><input inputMode="decimal" value={target} onChange={(e) => setTarget(e.target.value)} /></Field>
      </div>
      {metric === "net_revenue" && <Field label="Currency"><input value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase())} maxLength={3} /></Field>}
      <div className="task-row">
        <Field label="Start date"><input type="date" value={start} onChange={(e) => setStart(e.target.value)} /></Field>
        <Field label="Target date"><input type="date" value={due} onChange={(e) => setDue(e.target.value)} /></Field>
      </div>
      <Field label="Assigned agents" hint="Hold Cmd to choose more than one">
        <select multiple value={agents} onChange={(e) => setAgents([...e.target.selectedOptions].map((o) => o.value))} size={5}>
          {catalog.agents.filter((a) => a.status !== "retired").map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
      </Field>
      <label className="task-check"><input type="checkbox" checked={approval} onChange={(e) => setApproval(e.target.checked)} /> Needs evidence and my confirmation before it counts as achieved</label>
      {testMode && <p className="muted small">This goal will be test data.</p>}
      <ErrorLine error={error} />
      <div className="task-actions"><button className="btn primary" onClick={submit}>Save goal</button><button className="btn" onClick={onClose}>Cancel</button></div>
    </Panel>
  );
}

function GoalDetail({ goal, data, agentName, onClose }: { goal: BusinessGoal; data: BusinessData; agentName: (id: string) => string; onClose: () => void }) {
  const tasks = useTasks();
  const runs = useRuns();
  const { setView } = useAtlas();
  const [error, setError] = useState<string | null>(null);
  const [evLabel, setEvLabel] = useState("");
  const [evRef, setEvRef] = useState("");
  const [evKind, setEvKind] = useState<EvidenceRef["kind"]>("link");
  const [manual, setManual] = useState("");
  const ctx = { data, tasks, runs };
  const p = goalProgress(goal, ctx);
  const save = (next: BusinessGoal) => { const r = businessStore().put("goals", next, goal.rev); setError(r.ok ? null : r.error); };
  const linked = runs.filter((r) => goal.workflowRunIds.includes(r.id));
  const linkable = runs.filter((r) => !goal.workflowRunIds.includes(r.id));
  const taskById = new Map(tasks.map((t) => [t.id, t]));
  const runCost = (runId: string) => {
    const r = runs.find((x) => x.id === runId);
    return r ? Object.values(r.nodeTasks).reduce((n, id) => n + (taskById.get(id)?.usage.reduce((m, u) => m + (u.cost?.usd ?? 0), 0) ?? 0), 0) : 0;
  };
  return (
    <Panel title={goal.title} eyebrow={`Goal · ${DOMAIN_LABEL[goal.domain]}`} onClose={onClose}>
      <GoalBars goal={goal} p={p} />
      <dl className="biz-dl">
        <dt>Goal id</dt><dd><code>{goal.id}</code></dd>
        <dt>Target outcome</dt><dd>{goal.targetOutcome}</dd>
        <dt>Dates</dt><dd>{goal.startDate} to {goal.targetDate}</dd>
        <dt>Agents</dt><dd>{goal.agentIds.length ? goal.agentIds.map(agentName).join(", ") : "None assigned"}</dd>
        <dt>Approval</dt><dd>{goal.requiresApproval ? "Evidence and your confirmation needed" : "Your confirmation needed"}</dd>
        <dt>Source</dt><dd>{goal.source}</dd>
      </dl>

      <section>
        <div className="section-title">Contributing workflow runs</div>
        {linked.length ? (
          <ul className="biz-list">{linked.map((r) => <li key={r.id}><button className="text-btn inline" onClick={() => { focusWorkflowRun(r.goalId, r.id); setView("workflows"); }}>{r.snapshot.name}</button> <span className="muted small">started {r.createdAt.slice(0, 10)} · AI cost ${runCost(r.id).toFixed(2)}</span></li>)}</ul>
        ) : <p className="muted small">No workflow runs linked.</p>}
        {linkable.length > 0 && goal.state === "active" && (
          <select defaultValue="" onChange={(e) => e.target.value && save(linkRun(goal, e.target.value, nowIso()))} aria-label="Link a workflow run">
            <option value="">Link a workflow run…</option>
            {linkable.map((r) => <option key={r.id} value={r.id}>{r.snapshot.name} · {r.createdAt.slice(0, 10)}</option>)}
          </select>
        )}
      </section>

      {goal.metric === "manual" && goal.state === "active" && (
        <section>
          <div className="section-title">Measured value</div>
          <div className="task-artifact-form"><input inputMode="decimal" value={manual} onChange={(e) => setManual(e.target.value)} placeholder="Latest value" /><button className="btn" onClick={() => Number.isFinite(Number(manual)) && manual !== "" && save({ ...goal, manualValue: Number(manual), updatedAt: nowIso() })}>Record</button></div>
        </section>
      )}

      <section>
        <div className="section-title">Evidence</div>
        {goal.evidence.length ? <ul className="biz-list">{goal.evidence.map((e) => <li key={e.id}>{e.kind === "link" && /^https:/.test(e.ref) ? <a href={e.ref} target="_blank" rel="noreferrer">{e.label}</a> : e.label} <span className="muted small">{e.kind} · {e.ref} · {e.at.slice(0, 10)}</span></li>)}</ul> : <p className="muted small">No evidence yet.</p>}
        <div className="task-artifact-form">
          <select value={evKind} onChange={(e) => setEvKind(e.target.value as EvidenceRef["kind"])}>{["link", "sale", "customer", "lead", "product", "task", "workflow_run", "note"].map((k) => <option key={k} value={k}>{k.replace("_", " ")}</option>)}</select>
          <input value={evLabel} onChange={(e) => setEvLabel(e.target.value)} placeholder="What it shows" />
          <input value={evRef} onChange={(e) => setEvRef(e.target.value)} placeholder="Link or id" />
          <button className="btn" onClick={() => { const r = addEvidence(goal, { label: evLabel, ref: evRef, kind: evKind }, ME, nowIso()); if (!r.ok) return setError(r.error); save(r.value); setEvLabel(""); setEvRef(""); }}>Add</button>
        </div>
      </section>

      <ErrorLine error={error} />
      {goal.state === "active" && (
        <div className="task-actions">
          <button className="btn primary" disabled={!p.met} title={p.met ? "" : "The metric hasn't reached the target in real records"} onClick={() => { const r = confirmGoal(goal, ctx, ME, nowIso()); if (!r.ok) return setError(r.error); save(r.value); }}>Confirm achieved</button>
          <button className="btn" onClick={() => save({ ...goal, state: "cancelled", updatedAt: nowIso() })}>Cancel goal</button>
        </div>
      )}
    </Panel>
  );
}
