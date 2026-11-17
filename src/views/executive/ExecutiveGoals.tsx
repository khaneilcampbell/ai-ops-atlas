import { useEffect, useMemo, useState } from "react";
import { dismiss, useDismissedKeys } from "../../alerts/state";
import { aiCost, monthOf } from "../../business/finance";
import { useLedgers } from "../../execution/ledger";
import { AUTONOMY_INFO, AUTONOMY_LEVELS, GOAL_STATE_LABEL, type AutonomyLevel, type ExecutiveGoal } from "../../executive/types";
import { approvePlan, cancelGoal, delegate, draftGoal, editGoal, goalBudget, goalStatus, planGoal, reviewOutcome, syncGoal, type GoalStatus } from "../../executive/coordinator";
import { validatePlan } from "../../executive/plan";
import { executiveAttention, type ExecutiveSignal } from "../../executive/signals";
import { BRIEFING_LABEL, briefingText, buildBriefing, type BriefingKind } from "../../executive/briefing";
import { executiveContext } from "../../executive/context";
import { TEMPLATES } from "../../executive/templates";
import { executiveStore, useExecutive } from "../../executive/store";
import { useIntel } from "../../intelligence/app";
import { liveOutputs } from "../../outputs/live";
import { useWorkspace } from "../../product/workspace";
import { useAtlas } from "../../state";
import { focusTasks } from "../../tasks/focus";
import { taskBuildings } from "../../tasks/registry";
import { byId, taskService, useTasks } from "../../tasks/store";
import { ATLAS, CATEGORY_LABEL, KHANEIL, PRIORITY_LABEL, SENSITIVE_CATEGORIES, STATUS_LABEL, TASK_PRIORITIES, type SensitiveCategory, type StoredTask, type TaskPriority } from "../../tasks/types";
import { runStore, useRuns } from "../../workflows/runs";
import { focusWorkflowRun, selectNode } from "../../workflows/selection";
import { NODE_STATUS_LABEL } from "../../workflows/types";
import { formatDateTime } from "../../lib/timezone";
import "../../styles/tasks.css";
import "../../styles/executive.css";

// Mission Control > Executive goals (Phase 8). Khaneil states an objective; Agent Operations Lead
// turns it into a validated plan of registered agents; he approves it; the plan's steps go to the
// Task Center. Everything shown is read from goals, tasks, runs, ledgers and memory on this device.
// No polling and no model calls.

const EXAMPLES = [
  "Identify, validate and prepare an AI automation product for Benjaire",
  "Review my repositories and identify critical technical work",
  "Identify unfinished Atlas development tasks",
  "Summarize current business priorities",
  "Prepare a weekly operational briefing",
  "Investigate a failed automation",
  "Create an implementation plan for a project",
];

const lines = (s: string) => s.split("\n").map((x) => x.trim()).filter(Boolean);
const OPEN = new Set(["draft", "planned", "approved", "running", "review"]);

export function ExecutiveGoals() {
  const { catalog, setView } = useAtlas();
  const file = useExecutive();
  const tasks = useTasks();
  const runs = useRuns();
  const ledgers = useLedgers();
  const workspace = useWorkspace();
  const { file: intel } = useIntel(catalog);
  const dismissed = useDismissedKeys();
  const [showForm, setShowForm] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const taskMap = useMemo(() => byId(tasks), [tasks]);
  const now = Date.now();
  const store = executiveStore();

  // Running goals whose work finished move to review (never to "achieved": that's Khaneil's call).
  const statuses = useMemo(() => new Map(file.goals.map((g) => [g.id, goalStatus(g, runs, taskMap, catalog)])), [file.goals, runs, taskMap, catalog]);
  useEffect(() => {
    for (const g of file.goals) {
      const s = statuses.get(g.id);
      const next = s && syncGoal(g, s, new Date().toISOString());
      if (next) store.put(next, g.rev, ATLAS, "status_synced");
    }
  }, [file.goals, statuses, store]);

  const hidden = dismissed;
  const signals = useMemo(() => executiveAttention(file.goals, runs, taskMap, catalog, Date.now(), hidden), [file.goals, runs, taskMap, catalog, hidden]);
  const open = file.goals.filter((g) => OPEN.has(g.state)).sort((a, b) => TASK_PRIORITIES.indexOf(b.priority) - TASK_PRIORITIES.indexOf(a.priority) || b.createdAt.localeCompare(a.createdAt));
  const closed = file.goals.filter((g) => !OPEN.has(g.state)).slice(-5).reverse();

  const save = (r: { ok: true; goal: ExecutiveGoal } | { ok: false; error: string }, prev: ExecutiveGoal, action: string) => {
    if (!r.ok) return setMsg(r.error);
    const s = store.put(r.goal, prev.rev, KHANEIL, action);
    setMsg(s.ok ? null : s.error);
  };

  const openTask = (taskId: string) => {
    focusTasks({ query: taskId });
    setView("tasks");
  };
  const openRun = (goalId: string, runId: string, nodeId?: string, buildingId?: string) => {
    focusWorkflowRun(goalId, runId);
    if (nodeId) selectNode(nodeId, buildingId ?? null);
    setView("workflows");
  };

  return (
    <section className="card exec" aria-label="Executive goals">
      <div className="card-head exec-head">
        <h2 className="grow">Executive goals</h2>
        <label className="task-field exec-level">
          <span>Autonomy</span>
          <select
            value={file.autonomy}
            onChange={(e) => {
              const err = store.setAutonomy(Number(e.target.value) as AutonomyLevel, KHANEIL);
              setMsg(err);
            }}
          >
            {AUTONOMY_LEVELS.map((l) => (
              <option key={l} value={l}>
                {AUTONOMY_INFO[l].name}
              </option>
            ))}
          </select>
        </label>
        <button className="btn small primary" onClick={() => setShowForm((v) => !v)}>
          {showForm ? "Close" : "Set a goal"}
        </button>
      </div>
      <p className="muted small exec-pad">
        {AUTONOMY_INFO[file.autonomy].description} Agent Operations Lead plans each goal with registered agents; sensitive steps always wait for your approval.
      </p>
      {msg && <p className="task-error exec-pad">{msg}</p>}
      {showForm && <GoalIntake level={file.autonomy} onDone={(m) => (setMsg(m), m === null && setShowForm(false))} />}

      <div className="exec-grid">
        <div className="exec-col">
          <h3 className="exec-h">Active objectives</h3>
          {open.length === 0 && <p className="muted small">No goals yet. Set one, or pick an example.</p>}
          {open.map((g) => (
            <GoalCard key={g.id} g={g} s={statuses.get(g.id)!} save={save} openTask={openTask} openRun={openRun} tasks={tasks} records={intel.memory} now={now} workspace={workspace} />
          ))}
          {closed.length > 0 && (
            <details className="exec-closed">
              <summary className="muted small">Recently closed ({closed.length})</summary>
              <ul className="list">
                {closed.map((g) => (
                  <li key={g.id} className="list-row">
                    <div className="grow">
                      <div className="title">{g.objective}</div>
                      <div className="meta">
                        {GOAL_STATE_LABEL[g.state]}
                        {g.outcomeNote ? ` · ${g.outcomeNote}` : ""}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>

        <div className="exec-col">
          <Attention signals={signals} openTask={openTask} onDismiss={(key) => dismiss([key])} />
          <Activity tasks={tasks} openTask={openTask} />
          <Deliverables goals={file.goals} runs={runs} taskMap={taskMap} ledgers={ledgers} intel={intel} openRun={openRun} />
          <Resources tasks={tasks} goals={file.goals} runs={runs} />
        </div>
      </div>

      <BriefingPanel goals={file.goals} runs={runs} tasks={tasks} hidden={hidden} />
    </section>
  );
}

function GoalIntake({ level, onDone }: { level: AutonomyLevel; onDone: (msg: string | null) => void }) {
  const { catalog } = useAtlas();
  const [objective, setObjective] = useState("");
  const [projectId, setProjectId] = useState("");
  const [priority, setPriority] = useState<TaskPriority>("medium");
  const [deadline, setDeadline] = useState("");
  const [criteria, setCriteria] = useState("");
  const [constraints, setConstraints] = useState("");
  const [budget, setBudget] = useState("");
  const [approvals, setApprovals] = useState<SensitiveCategory[]>([]);
  const buildings = useMemo(() => taskBuildings(catalog), [catalog]);

  const submit = () => {
    const at = new Date().toISOString();
    const d = draftGoal(
      { objective, projectId: projectId || undefined, priority, deadline: deadline || undefined, successCriteria: lines(criteria), constraints: lines(constraints), budgetUsd: budget.trim() ? Number(budget) : undefined, requiredApprovals: approvals },
      KHANEIL,
      at,
      catalog,
      level,
    );
    if (!d.ok) return onDone(d.error);
    const store = executiveStore();
    const added = store.add(d.goal, KHANEIL);
    if (!added.ok) return onDone(added.error);
    // Level 1+ drafts the plan straight away (deterministic template, no model). Level 0 doesn't.
    if (level >= 1) {
      const p = planGoal(added.goal, KHANEIL, at);
      if (p.ok) store.put(p.goal, added.goal.rev, KHANEIL, "plan_drafted");
      else return onDone(`Goal saved. ${p.error}${p.route ? ` A model-drafted plan would use ${p.route.model ?? "no model"} (about $${p.route.estimatedUsd.toFixed(3)}); that's your call.` : ""}`);
    }
    onDone(null);
  };

  return (
    <div className="exec-form task-form">
      <div className="chips">
        {EXAMPLES.map((e) => (
          <button key={e} className="chip" onClick={() => setObjective(e)}>
            {e}
          </button>
        ))}
      </div>
      <label className="task-field">
        <span>Objective</span>
        <textarea rows={2} value={objective} onChange={(e) => setObjective(e.target.value)} placeholder="What do you want done, in your words" />
      </label>
      <div className="task-row">
        <label className="task-field">
          <span>Project or business</span>
          <select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
            <option value="">From the plan template</option>
            {buildings.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </label>
        <label className="task-field">
          <span>Priority</span>
          <select value={priority} onChange={(e) => setPriority(e.target.value as TaskPriority)}>
            {TASK_PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {PRIORITY_LABEL[p]}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="task-row">
        <label className="task-field">
          <span>Deadline (optional)</span>
          <input type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
        </label>
        <label className="task-field">
          <span>Budget in USD (optional)</span>
          <input inputMode="decimal" value={budget} onChange={(e) => setBudget(e.target.value)} placeholder="No budget set" />
        </label>
      </div>
      <div className="task-row">
        <label className="task-field">
          <span>Success criteria, one per line</span>
          <textarea rows={3} value={criteria} onChange={(e) => setCriteria(e.target.value)} placeholder="Left empty: the template's criteria" />
        </label>
        <label className="task-field">
          <span>Constraints, one per line</span>
          <textarea rows={3} value={constraints} onChange={(e) => setConstraints(e.target.value)} />
        </label>
      </div>
      <fieldset className="task-field">
        <legend>Approvals this goal needs</legend>
        <div className="chips">
          {SENSITIVE_CATEGORIES.map((c) => (
            <label key={c} className="chip">
              <input type="checkbox" checked={approvals.includes(c)} onChange={(e) => setApprovals((a) => (e.target.checked ? [...a, c] : a.filter((x) => x !== c)))} /> {CATEGORY_LABEL[c]}
            </label>
          ))}
        </div>
      </fieldset>
      <div>
        <button className="btn primary" onClick={submit}>
          Save goal{level >= 1 ? " and draft a plan" : ""}
        </button>
      </div>
    </div>
  );
}

interface CardProps {
  g: ExecutiveGoal;
  s: GoalStatus;
  save: (r: { ok: true; goal: ExecutiveGoal } | { ok: false; error: string }, prev: ExecutiveGoal, action: string) => void;
  openTask: (id: string) => void;
  openRun: (goalId: string, runId: string, nodeId?: string, buildingId?: string) => void;
  tasks: readonly StoredTask[];
  records: Parameters<typeof executiveContext>[1];
  now: number;
  workspace: ReturnType<typeof useWorkspace>;
}

function GoalCard({ g, s, save, openTask, openRun, tasks, records, now, workspace }: CardProps) {
  const { catalog } = useAtlas();
  const [expanded, setExpanded] = useState(g.state === "planned");
  const [template, setTemplate] = useState("");
  const [note, setNote] = useState("");
  const [editing, setEditing] = useState(false);
  const validation = useMemo(() => (g.plan ? validatePlan(g.plan, g, catalog, workspace) : null), [g, catalog, workspace]);
  const budget = goalBudget(g, tasks, runStore().list());
  const context = useMemo(() => (expanded ? executiveContext(g, records, now) : null), [expanded, g, records, now]);
  const at = () => new Date().toISOString();
  const project = catalog.projects.find((p) => p.id === g.projectId);

  return (
    <article className={`exec-goal pri-${g.priority}`}>
      <button className="exec-goal-top" onClick={() => setExpanded((v) => !v)} aria-expanded={expanded}>
        <span className="exec-goal-title">{g.objective}</span>
        <span className="exec-goal-meta">
          <span className="chip">{PRIORITY_LABEL[g.priority]}</span>
          <span className="chip">{GOAL_STATE_LABEL[g.state]}</span>
          {project && <span className="muted small">{project.name}</span>}
          {g.deadline && <span className="muted small">Due {g.deadline}</span>}
        </span>
        {s.progress !== null && (
          <span className="exec-progress" aria-label={`${s.done} of ${s.total} steps done`}>
            <i style={{ width: `${Math.round(s.progress * 100)}%` }} />
          </span>
        )}
        <span className="muted small">
          {s.progress !== null ? `${s.done} of ${s.total} steps done` : "Not delegated yet"}
          {s.nextMilestone ? ` · Next: ${s.nextMilestone}` : ""}
        </span>
      </button>

      {expanded && (
        <div className="exec-goal-body">
          {s.agents.length > 0 && (
            <div className="chips">
              {s.agents.map((a, i) => (
                <span key={`${a.id}-${i}`} className="chip" title={NODE_STATUS_LABEL[a.status]}>
                  {a.name} · {NODE_STATUS_LABEL[a.status]}
                </span>
              ))}
            </div>
          )}
          <dl className="exec-facts">
            <div>
              <dt>Success criteria</dt>
              <dd>{g.successCriteria.length ? g.successCriteria.join("; ") : "Not documented"}</dd>
            </div>
            <div>
              <dt>Constraints</dt>
              <dd>{g.constraints.length ? g.constraints.join("; ") : "None given"}</dd>
            </div>
            <div>
              <dt>Budget</dt>
              <dd>
                {budget.limitUsd === null ? "No budget set" : `$${budget.usedUsd.toFixed(2)} of $${budget.limitUsd.toFixed(2)} reported`}
                {budget.estimated ? " (includes estimates)" : ""}
              </dd>
            </div>
            <div>
              <dt>Autonomy</dt>
              <dd>{AUTONOMY_INFO[g.autonomy].name}</dd>
            </div>
          </dl>

          {editing && <GoalEdit g={g} onSave={(patch) => (save(editGoal(g, patch, KHANEIL, at(), catalog), g, "goal_edited"), setEditing(false))} onCancel={() => setEditing(false)} />}

          {g.plan && validation && (
            <div className="exec-plan">
              <div className="exec-plan-head">
                <strong>Plan</strong>
                <span className="muted small">
                  {g.plan.definition.name} · {g.plan.reason} · Model caps up to ${g.plan.maxSpendUsd.toFixed(2)}
                </span>
              </div>
              {!validation.ok && (
                <div className="task-callout warn">
                  <strong>Can't be approved yet</strong>
                  {validation.problems.slice(0, 4).map((p) => (
                    <span key={p}>{p}</span>
                  ))}
                </div>
              )}
              {validation.budget && <div className="task-callout warn">{validation.budget}</div>}
              <ol className="exec-steps">
                {validation.steps.map((st) => {
                  const node = g.plan!.definition.nodes.find((n) => n.id === st.nodeId)!;
                  const step = g.plan!.steps.find((x) => x.nodeId === st.nodeId);
                  const deps = g.plan!.definition.edges.filter((e) => e.to === st.nodeId).map((e) => g.plan!.definition.nodes.find((n) => n.id === e.from)?.title ?? e.from);
                  const status = s.status.get(st.nodeId);
                  const taskId = s.run?.nodeTasks[st.nodeId];
                  return (
                    <li key={st.nodeId} className={st.problems.length ? "bad" : ""}>
                      <div className="exec-step-top">
                        <strong>{st.title}</strong>
                        <span className="muted small">{st.agentName ?? (node.kind === "approval" ? "Your approval" : node.kind === "decision" ? "Your decision" : "A person")}</span>
                        {status && <span className="chip">{NODE_STATUS_LABEL[status]}</span>}
                        {node.approval && <span className="chip warn">Approval: {node.approval.categories.map((c) => CATEGORY_LABEL[c]).join(", ")}</span>}
                        {step && step.tier > 0 && <span className="chip">Tier {step.tier} · cap ${step.capUsd}</span>}
                      </div>
                      <div className="muted small">
                        {deps.length ? `After: ${deps.join(", ")}` : "Starts first"}
                        {st.parallelWith.length ? " · runs alongside others" : ""}
                        {step ? ` · Done when: ${step.completion}` : ""}
                        {step ? ` · On failure: ${step.failure === "retry_then_ask" ? "retry within the task's limit, then ask you" : "stop and ask you"}` : ""}
                      </div>
                      {[...st.problems, ...st.notes].map((n) => (
                        <div key={n} className={st.problems.includes(n) ? "task-error small" : "muted small"}>
                          {n}
                        </div>
                      ))}
                      {taskId && (
                        <button className="text-btn small" onClick={() => openTask(taskId)}>
                          Open task
                        </button>
                      )}
                      {s.run && (
                        <button className="text-btn small" onClick={() => openRun(g.id, s.run!.id, st.nodeId, undefined)}>
                          Outputs
                        </button>
                      )}
                    </li>
                  );
                })}
              </ol>
            </div>
          )}

          {context && context.items.length > 0 && (
            <div className="exec-context">
              <strong className="small">Context Atlas would use (data, with sources)</strong>
              <ul>
                {context.items.map((c) => (
                  <li key={c.id} className="small">
                    {c.title} <span className="muted">· {c.verification} · {c.source.kind}: {c.source.ref}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="exec-actions">
            {(g.state === "draft" || g.state === "planned" || g.state === "approved") && (
              <>
                <select value={template} onChange={(e) => setTemplate(e.target.value)} aria-label="Plan template">
                  <option value="">{g.plan ? "Re-plan with template..." : "Pick a template..."}</option>
                  {TEMPLATES.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
                <button className="btn small" onClick={() => save(planGoal(g, KHANEIL, at(), template || undefined), g, "plan_drafted")}>
                  {g.plan ? "Re-plan" : "Draft plan"}
                </button>
                <button className="btn small" onClick={() => setEditing((v) => !v)}>
                  Edit goal
                </button>
              </>
            )}
            {g.state === "planned" && (
              <button className="btn small primary" disabled={!validation?.ok} onClick={() => save(approvePlan(g, KHANEIL, at(), catalog, workspace), g, "plan_approved")}>
                Approve plan
              </button>
            )}
            {g.state === "approved" && (
              <button
                className="btn small primary"
                onClick={() => {
                  const r = delegate(g, { svc: taskService(), runs: runStore(), catalog, workspace, tasks }, KHANEIL, at());
                  save(r.ok ? { ok: true, goal: r.goal } : r, g, "plan_started");
                }}
              >
                Start plan (create tasks)
              </button>
            )}
            {s.run && (
              <button className="btn small" onClick={() => openRun(g.id, s.run!.id)}>
                Open in Workflow Intelligence
              </button>
            )}
            {g.state === "review" && (
              <>
                <input className="exec-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="What was achieved?" aria-label="Outcome note" />
                <button className="btn small primary" onClick={() => save(reviewOutcome(g, true, note, KHANEIL, at()), g, "outcome_achieved")}>
                  Achieved
                </button>
                <button className="btn small" onClick={() => save(reviewOutcome(g, false, note, KHANEIL, at()), g, "outcome_not_achieved")}>
                  Not achieved
                </button>
              </>
            )}
            <button className="text-btn small" onClick={() => save(cancelGoal(g, KHANEIL, at()), g, "goal_cancelled")}>
              Cancel goal
            </button>
          </div>
          <div className="muted small">Created {formatDateTime(g.createdAt)}{g.planApprovedAt ? ` · plan approved ${formatDateTime(g.planApprovedAt)}` : ""}</div>
        </div>
      )}
    </article>
  );
}

function GoalEdit({ g, onSave, onCancel }: { g: ExecutiveGoal; onSave: (patch: Parameters<typeof editGoal>[1]) => void; onCancel: () => void }) {
  const [objective, setObjective] = useState(g.objective);
  const [priority, setPriority] = useState(g.priority);
  const [deadline, setDeadline] = useState(g.deadline ?? "");
  const [budget, setBudget] = useState(g.budgetUsd === undefined ? "" : String(g.budgetUsd));
  const [criteria, setCriteria] = useState(g.successCriteria.join("\n"));
  const [constraints, setConstraints] = useState(g.constraints.join("\n"));
  return (
    <div className="exec-form task-form">
      <label className="task-field">
        <span>Objective</span>
        <textarea rows={2} value={objective} onChange={(e) => setObjective(e.target.value)} />
      </label>
      <div className="task-row">
        <label className="task-field">
          <span>Priority</span>
          <select value={priority} onChange={(e) => setPriority(e.target.value as TaskPriority)}>
            {TASK_PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {PRIORITY_LABEL[p]}
              </option>
            ))}
          </select>
        </label>
        <label className="task-field">
          <span>Deadline (optional)</span>
          <input type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
        </label>
        <label className="task-field">
          <span>Budget USD (optional)</span>
          <input inputMode="decimal" value={budget} onChange={(e) => setBudget(e.target.value)} />
        </label>
      </div>
      <div className="task-row">
        <label className="task-field">
          <span>Success criteria</span>
          <textarea rows={3} value={criteria} onChange={(e) => setCriteria(e.target.value)} />
        </label>
        <label className="task-field">
          <span>Constraints</span>
          <textarea rows={3} value={constraints} onChange={(e) => setConstraints(e.target.value)} />
        </label>
      </div>
      <div className="exec-actions">
        <button className="btn small primary" onClick={() => onSave({ objective, priority, deadline: deadline || undefined, budgetUsd: budget.trim() ? Number(budget) : undefined, successCriteria: lines(criteria), constraints: lines(constraints) })}>
          Save changes
        </button>
        <button className="btn small" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function Attention({ signals, openTask, onDismiss }: { signals: ExecutiveSignal[]; openTask: (id: string) => void; onDismiss: (key: string) => void }) {
  return (
    <div className="exec-box">
      <h3 className="exec-h">Executive attention</h3>
      {signals.length === 0 ? (
        <p className="muted small">Nothing blocked: no pending approvals, failed steps, stalled plans or budget warnings on your goals.</p>
      ) : (
        <ul className="list">
          {signals.slice(0, 8).map((s) => (
            <li key={s.key} className="list-row">
              <span className={`sev ${s.severity}`} />
              <div className="grow">
                <div className="title">{s.title}</div>
                <div className="meta">{s.detail}</div>
              </div>
              {s.taskId && (
                <button className="text-btn small" onClick={() => openTask(s.taskId!)}>
                  Open
                </button>
              )}
              <button className="text-btn small" onClick={() => onDismiss(s.key)} aria-label={`Dismiss ${s.title}`}>
                Dismiss
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Activity({ tasks, openTask }: { tasks: readonly StoredTask[]; openTask: (id: string) => void }) {
  const working = tasks.filter((t) => t.status === "running" && t.agentName);
  const recent = tasks
    .filter((t) => t.status === "completed" && t.completedAt)
    .sort((a, b) => (b.completedAt ?? "").localeCompare(a.completedAt ?? ""))
    .slice(0, 4);
  return (
    <div className="exec-box">
      <h3 className="exec-h">Agent activity</h3>
      <p className="muted small">{working.length ? `${working.length} working now: ${[...new Set(working.map((t) => t.agentName))].join(", ")}` : "No agent is running a Task Center task right now."}</p>
      {recent.length > 0 && (
        <ul className="list">
          {recent.map((t) => (
            <li key={t.id}>
              <button className="list-row" onClick={() => openTask(t.id)}>
                <div className="grow">
                  <div className="title">{t.title}</div>
                  <div className="meta">
                    {STATUS_LABEL[t.status]} {t.completedAt ? formatDateTime(t.completedAt) : ""}
                    {t.agentName ? ` · ${t.agentName}` : ""}
                  </div>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Deliverables(p: { goals: readonly ExecutiveGoal[]; runs: ReturnType<typeof useRuns>; taskMap: ReadonlyMap<string, StoredTask>; ledgers: ReturnType<typeof useLedgers>; intel: ReturnType<typeof useIntel>["file"]; openRun: CardProps["openRun"] }) {
  const items = useMemo(() => {
    const ledgerOf = new Map(p.ledgers.map((l) => [l.runId, l]));
    return p.goals.flatMap((g) =>
      p.runs
        .filter((r) => g.runIds.includes(r.id))
        .flatMap((run) => liveOutputs({ run, tasks: p.taskMap, ledger: ledgerOf.get(run.id), contexts: p.intel.contexts, evaluations: p.intel.evaluations }).map((o) => ({ o, g, run }))),
    );
  }, [p.goals, p.runs, p.taskMap, p.ledgers, p.intel.contexts, p.intel.evaluations]);
  const verified = items.filter((x) => x.o.verificationStatus === "verified" && x.o.state === "complete");
  return (
    <div className="exec-box">
      <h3 className="exec-h">Completed deliverables</h3>
      {verified.length === 0 ? (
        <p className="muted small">{items.length ? `${items.length} output${items.length === 1 ? "" : "s"} recorded, none verified yet.` : "No goal has delivered an output yet."} Only schema-checked results on finished tasks count as verified.</p>
      ) : (
        <ul className="list">
          {verified.slice(0, 6).map(({ o, g, run }) => (
            <li key={o.id}>
              <button className="list-row" onClick={() => p.openRun(g.id, run.id, o.nodeId)}>
                <div className="grow">
                  <div className="title">{o.title}</div>
                  <div className="meta">
                    {o.category} · {g.objective}
                  </div>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Resources({ tasks, goals, runs }: { tasks: readonly StoredTask[]; goals: readonly ExecutiveGoal[]; runs: ReturnType<typeof useRuns> }) {
  const cost = aiCost(tasks, monthOf(new Date()));
  const goalRuns = runs.filter((r) => goals.some((g) => g.runIds.includes(r.id)));
  const attempts = tasks.reduce((n, t) => n + t.attempts.length, 0);
  return (
    <div className="exec-box">
      <h3 className="exec-h">Resources this month</h3>
      <dl className="exec-facts">
        <div>
          <dt>AI cost</dt>
          <dd>{cost.tasks ? `$${cost.usd.toFixed(2)}${cost.estimated ? " (includes estimates)" : ""} on ${cost.tasks} task${cost.tasks === 1 ? "" : "s"}` : "No usage reported"}</dd>
        </div>
        <div>
          <dt>Model usage</dt>
          <dd>{tasks.reduce((n, t) => n + t.usage.length, 0)} reports on Task Center tasks</dd>
        </div>
        <div>
          <dt>Workflow executions</dt>
          <dd>
            {goalRuns.length} goal run{goalRuns.length === 1 ? "" : "s"} · {attempts} task attempt{attempts === 1 ? "" : "s"} in all
          </dd>
        </div>
      </dl>
    </div>
  );
}

function BriefingPanel({ goals, runs, tasks, hidden }: { goals: readonly ExecutiveGoal[]; runs: ReturnType<typeof useRuns>; tasks: readonly StoredTask[]; hidden: ReadonlySet<string> }) {
  const { catalog } = useAtlas();
  const [kind, setKind] = useState<BriefingKind | null>(null);
  const [projectId, setProjectId] = useState("");
  const buildings = useMemo(() => taskBuildings(catalog), [catalog]);
  const b = useMemo(() => (kind ? buildBriefing({ kind, goals, runs, tasks, catalog, now: Date.now(), projectId, dismissed: hidden }) : null), [kind, goals, runs, tasks, catalog, projectId, hidden]);
  const copy = () => b && navigator.clipboard?.writeText(briefingText(b)).catch(() => undefined);
  return (
    <div className="exec-brief">
      <div className="exec-actions">
        <strong className="grow">Executive briefing</strong>
        {(Object.keys(BRIEFING_LABEL) as BriefingKind[]).map((k) => (
          <button key={k} className={`btn small${kind === k ? " primary" : ""}`} onClick={() => setKind(kind === k ? null : k)}>
            {BRIEFING_LABEL[k]}
          </button>
        ))}
        {kind === "project" && (
          <select value={projectId} onChange={(e) => setProjectId(e.target.value)} aria-label="Project">
            <option value="">Pick a project</option>
            {buildings.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </select>
        )}
      </div>
      {b && (
        <div className="exec-brief-body">
          <p className="muted small">
            Built from Atlas records for {b.period.from === b.period.to ? b.period.from : `${b.period.from} to ${b.period.to}`}. No model was used.{" "}
            <button className="text-btn small" onClick={copy}>
              Copy as text
            </button>
          </p>
          <div className="exec-brief-grid">
            <BriefSec title="Goals in progress" xs={b.inProgress.map((x) => x.text)} />
            <BriefSec title="Completed work" xs={b.completedWork.map((x) => x.text)} />
            <BriefSec title="Outcomes" xs={b.outcomes.map((x) => x.text)} />
            <BriefSec title="Pending decisions" xs={b.decisions.map((x) => x.text)} />
            <BriefSec title="Operational problems" xs={b.problems.map((x) => x.text)} />
            <BriefSec title="Upcoming milestones" xs={b.milestones.map((x) => x.text)} />
            <BriefSec title="AI usage and cost" xs={[`$${b.ai.usd.toFixed(2)}${b.ai.estimated ? " (includes estimates)" : ""} across ${b.ai.tasksWithUsage} task${b.ai.tasksWithUsage === 1 ? "" : "s"} with reported usage`]} />
            <BriefSec title="Recommended next actions" xs={b.nextActions} empty="Nothing needs you." />
          </div>
        </div>
      )}
    </div>
  );
}

function BriefSec({ title, xs, empty = "None" }: { title: string; xs: string[]; empty?: string }) {
  return (
    <div>
      <div className="exec-h">{title}</div>
      <ul className="small">
        {xs.length ? xs.slice(0, 6).map((x) => <li key={x}>{x}</li>) : <li className="muted">{empty}</li>}
      </ul>
    </div>
  );
}
