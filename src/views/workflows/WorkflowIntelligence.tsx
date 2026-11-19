import { useMemo, useState } from "react";
import { ExternalLink } from "../../components/bits";
import { Icon } from "../../components/Icon";
import { relative } from "../../lib/time";
import { formatDateTime } from "../../lib/timezone";
import { useAtlas } from "../../state";
import { focusTasks } from "../../tasks/focus";
import { unmetDependencies } from "../../tasks/lifecycle";
import { byId, taskService, useTasks } from "../../tasks/store";
import { CATEGORY_LABEL, KHANEIL, STATUS_LABEL, type StoredTask } from "../../tasks/types";
import { DEFINITIONS as SAVED_DEFINITIONS, GOALS as SAVED_GOALS } from "../../workflows/benjaireLaunch";
import { executiveWorkflows } from "../../executive/coordinator";
import { useExecutive } from "../../executive/store";
import { ownerOf } from "../../operations/engine";
import { useOps } from "../../operations/store";
import { incidentEvents, incidentOf, incidentOutputs, incidentStatus, incidentWorkflows } from "../../operations/workflow";
import { INCIDENT_STATE_LABEL } from "../../operations/types";
import { buildingActivity, liveEvents, liveStatus, resolveAll, simulate, type ResolvedNode } from "../../workflows/engine";
import { downstream, layout as layoutOf, upstream } from "../../workflows/graph";
import { runStore, startLiveRun, useRuns } from "../../workflows/runs";
import { runProblem } from "../../product/templates";
import { useWorkspace } from "../../product/workspace";
import { NodeBusiness } from "../business/NodeBusiness";
import { selectBuilding, selectNode, takeWorkflowRunFocus, useWorkflowSelection } from "../../workflows/selection";
import { NODE_STATUS_LABEL, type ExecutionEvent, type NodeStatus, type RunMode, type WorkflowDefinition, type WorkflowNode, type WorkflowRun } from "../../workflows/types";
import { statusTone, WorkflowCanvas } from "./WorkflowCanvas";
import { RunExecution, useRunLedger } from "./RunExecution";
import { RUN_STATUS_LABEL, runStatus, stepTiming } from "../../execution/report";
import { useIntel } from "../../intelligence/app";
import { liveOutputs } from "../../outputs/live";
import { simRunId, simulatedOutputs } from "../../outputs/simulation";
import { scopeOutputs } from "../../outputs/validate";
import { OutputStudio, useStableOutputs } from "./OutputStudio";
import type { HandoffRecord } from "../../execution/types";
import "../../styles/workflows.css";

// Workflow Intelligence: pick a goal, see the agents and dependencies it needs, step through a
// simulation, or follow a live run whose every status comes from the Task Center. This view never
// runs work itself: actions open the Task Center, which owns approvals and execution.

const EXEC_LABEL: Record<WorkflowNode["execution"]["kind"], string> = {
  n8n: "n8n",
  github: "GitHub Actions",
  owned: "Through its own automations",
  manual: "A person, recorded in the Task Center",
  none: "Not configured",
};

export function WorkflowIntelligenceView() {
  const { catalog, setView, select } = useAtlas();
  const tasks = useTasks();
  const runs = useRuns();
  const sel = useWorkflowSelection();

  // Saved goals plus every executive goal with a plan (Mission Control > Executive goals).
  const executive = useExecutive();
  // Phase 9: recent incidents, each as its fixed recovery workflow (Mission Control > Autonomous operations).
  const ops = useOps();
  const { GOALS, DEFINITIONS } = useMemo(() => {
    const x = executiveWorkflows(executive.goals);
    const inc = incidentWorkflows(ops, ownerOf);
    return { GOALS: [...SAVED_GOALS, ...x.goals, ...inc.goals], DEFINITIONS: { ...SAVED_DEFINITIONS, ...x.definitions, ...inc.definitions } };
  }, [executive.goals, ops]);
  const [focus] = useState(takeWorkflowRunFocus);
  const [goalId, setGoalId] = useState(focus && GOALS.some((g) => g.id === focus.goalId) ? focus.goalId : GOALS[0].id);
  const goal = GOALS.find((g) => g.id === goalId) ?? GOALS[0];
  const incident = incidentOf(ops, goal.id);
  const isExecutive = !incident && !SAVED_GOALS.some((g) => g.id === goal.id);
  const [mode, setMode] = useState<RunMode>(focus ? "live" : "simulation");
  const goalRuns = useMemo(() => runs.filter((r) => r.goalId === goal.id).slice().reverse(), [runs, goal.id]);
  const [runId, setRunId] = useState<string | null>(focus?.runId ?? null);
  const run: WorkflowRun | undefined = goalRuns.find((r) => r.id === runId) ?? goalRuns[0];

  // A live run reads its own frozen definition; a simulation reads the saved template.
  const def: WorkflowDefinition = mode === "live" && run ? run.snapshot : DEFINITIONS[goal.definitionId];
  const resolved = useMemo(() => resolveAll(def, catalog), [def, catalog]);
  const graph = useMemo(() => layoutOf(def), [def]);

  const [step, setStep] = useState(0);
  const [viable, setViable] = useState(true);
  const [standIn, setStandIn] = useState(false);
  const decisionIds = useMemo(() => def.nodes.filter((n) => n.kind === "decision").map((n) => n.id), [def]);
  const names = useMemo(() => (id: string) => resolved.get(id)?.agentName ?? def.nodes.find((n) => n.id === id)?.title ?? id, [resolved, def]);

  const taskMap = useMemo(() => byId(tasks), [tasks]);
  const sim = useMemo(
    () => simulate(def, { branches: Object.fromEntries(decisionIds.map((id) => [id, viable ? "yes" : "no"])), manualStandIn: standIn }, step, names),
    [def, decisionIds, viable, standIn, step, names],
  );
  const live = useMemo(() => {
    if (mode === "live" && incident) return { status: incidentStatus(incident, ops), events: incidentEvents(incident, ops) };
    if (mode !== "live" || !run) return null;
    return { status: liveStatus(def, run, taskMap), events: liveEvents(run, taskMap) };
  }, [mode, run, def, taskMap, incident, ops]);

  const status = useMemo<ReadonlyMap<string, NodeStatus>>(
    () => live?.status ?? (mode === "live" ? new Map(def.nodes.map((n) => [n.id, n.unconfigured ? "unconfigured" : "not_started"] as const)) : sim.status),
    [live, mode, def, sim.status],
  );
  const events: ExecutionEvent[] = live?.events ?? (mode === "simulation" ? sim.events : []);
  const buildings = useMemo(() => buildingActivity(def, resolved, status), [def, resolved, status]);

  const pick = (id: string) => {
    const same = sel.nodeId === id;
    selectNode(same ? null : id, same ? null : (resolved.get(id)?.buildingId ?? null));
  };
  const focusOnMap = (buildingId: string) => {
    setView("map");
    select({ kind: "project", id: buildingId });
  };
  const openTask = (taskId: string) => {
    focusTasks({ query: taskId });
    setView("tasks");
  };

  const [confirming, setConfirming] = useState(false);
  const [startMsg, setStartMsg] = useState<string | null>(null);
  const workspace = useWorkspace();
  const start = () => {
    // The active workspace can turn agents off or cap their model tier; such a run never starts.
    const blocked = runProblem(DEFINITIONS[goal.definitionId], workspace, catalog);
    if (blocked) {
      setConfirming(false);
      setStartMsg(blocked);
      return;
    }
    const r = startLiveRun(goal, DEFINITIONS[goal.definitionId], taskService(), runStore(), catalog, KHANEIL);
    setConfirming(false);
    setStartMsg(r.error);
    if (r.run) {
      setRunId(r.run.id);
      setMode("live");
    }
  };

  const node = sel.nodeId ? def.nodes.find((n) => n.id === sel.nodeId) : undefined;
  const ledger = useRunLedger(run?.id);

  // Agent Output Studio: live outputs only from this run's records, simulated ones only from the
  // fixed samples, each scoped to its own run id so the two can't mix.
  const { file: intel } = useIntel(catalog);
  const simNodes = useMemo(
    () => ({ started: new Set(sim.events.filter((e) => e.type !== "skipped").map((e) => e.nodeId)), completed: new Set(sim.events.filter((e) => e.type === "completed").map((e) => e.nodeId)) }),
    [sim.events],
  );
  const rawOutputs = useMemo(() => {
    if (mode === "simulation") return simulatedOutputs(def, sim.status, { standIn, startedNodes: simNodes.started, completedNodes: simNodes.completed });
    if (incident) return incidentOutputs(incident, ops, incident.resolution ? [] : incident.escalation ? ["Khaneil decides the next step; Atlas won't retry further on its own."] : []);
    return run ? liveOutputs({ run, tasks: taskMap, ledger, contexts: intel.contexts, evaluations: intel.evaluations }) : [];
  }, [mode, def, sim.status, standIn, simNodes, run, taskMap, ledger, intel.contexts, intel.evaluations, incident, ops]);
  const outputs = useStableOutputs(useMemo(() => scopeOutputs(rawOutputs, { mode, runIds: new Set(mode === "simulation" ? [simRunId(def.id)] : incident ? [def.id] : run ? [run.id] : []) }), [rawOutputs, mode, def.id, run, incident]));
  const runLabel = mode === "simulation" ? (sim.step === 0 ? "Preview, not started" : `Simulation step ${sim.step} of ${sim.maxStep}`) : incident ? `Incident · ${INCIDENT_STATE_LABEL[incident.state]}` : run && ledger ? RUN_STATUS_LABEL[runStatus(run, taskMap, ledger)] : "No live run";
  const pickOutput = (id: string) => {
    if (sel.nodeId !== id) selectNode(id, resolved.get(id)?.buildingId ?? null);
  };

  return (
    <div className="page wf-page">
      <div className="page-head">
        <div className="grow">
          <div className="eyebrow">Mission Control</div>
          <h1>Workflow Intelligence</h1>
          <p className="lede">Pick a goal, see who does each step and what it depends on, then preview it or follow a live run from the Task Center.</p>
        </div>
        <button className="ghost-btn dark" onClick={() => setView("overview")}>
          <Icon name="overview" size={16} /> Back to Mission Control
        </button>
      </div>

      <section className="card wf-goal" aria-label="Goal">
        <div className="wf-goal-main">
          <label className="field wf-goal-pick">
            <span className="muted">Goal</span>
            <select value={goal.id} onChange={(e) => (setGoalId(e.target.value), setStep(0), setRunId(null))}>
              {GOALS.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </label>
          <h2 className="wf-goal-name">{goal.name}</h2>
          <dl className="wf-goal-facts">
            <div>
              <dt>Objective</dt>
              <dd>{goal.objective}</dd>
            </div>
            <div>
              <dt>Expected outcome</dt>
              <dd>{goal.expectedOutcome}</dd>
            </div>
            <div>
              <dt>Template</dt>
              <dd>
                {def.name} · v{def.version} · {def.nodes.length} steps
              </dd>
            </div>
          </dl>
        </div>

        <div className="wf-goal-side">
          <div className="seg-ctl" role="tablist" aria-label="Mode">
            <button role="tab" aria-selected={mode === "simulation"} className={mode === "simulation" ? "on" : ""} onClick={() => setMode("simulation")}>
              Simulation
            </button>
            <button role="tab" aria-selected={mode === "live"} className={mode === "live" ? "on" : ""} onClick={() => setMode("live")}>
              Live
            </button>
          </div>

          {mode === "simulation" ? (
            <div className="wf-sim">
              <div className="wf-banner sim">Simulated data. Saved template and mock states only: no workflow is called and nothing changes.</div>
              <div className="wf-stepper">
                <button className="btn small" onClick={() => setStep(Math.max(0, sim.step - 1))} disabled={sim.step === 0}>
                  Back
                </button>
                <input type="range" min={0} max={sim.maxStep} value={sim.step} onChange={(e) => setStep(Number(e.target.value))} aria-label="Simulation step" />
                <button className="btn small primary" onClick={() => setStep(Math.min(sim.maxStep, sim.step + 1))} disabled={sim.step === sim.maxStep}>
                  Next step
                </button>
              </div>
              <div className="muted small">
                {sim.step === 0 ? "Preview: nothing started." : `Step ${sim.step} of ${sim.maxStep}`}
                {sim.haltedAt && ` · Stopped at ${def.nodes.find((n) => n.id === sim.haltedAt)?.title} (unconfigured)`}
              </div>
              <div className="wf-sim-opts">
                {decisionIds.length > 0 && (
                  <label className="wf-check">
                    <input type="checkbox" checked={viable} onChange={(e) => setViable(e.target.checked)} /> Viability decision says go ahead
                  </label>
                )}
                <label className="wf-check">
                  <input type="checkbox" checked={standIn} onChange={(e) => setStandIn(e.target.checked)} /> Assume a person does unconfigured steps
                </label>
              </div>
            </div>
          ) : (
            <div className="wf-live">
              {goalRuns.length > 0 && (
                <label className="field">
                  <span className="muted">Run</span>
                  <select value={run?.id ?? ""} onChange={(e) => setRunId(e.target.value)}>
                    {goalRuns.map((r) => (
                      <option key={r.id} value={r.id}>
                        {formatDateTime(r.createdAt)} · v{r.definitionVersion}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {incident ? (
                <div className="muted small">Live incident, from this device's operations records: detected {formatDateTime(incident.firstAt)}, {incident.count} report{incident.count === 1 ? "" : "s"}, severity {incident.severity}. Recovery starts from Mission Control, Autonomous operations.</div>
              ) : run ? (
                <div className="muted small">
                  Started {relative(run.createdAt)} by {run.createdBy} on template v{run.definitionVersion}
                  {run.definitionVersion !== DEFINITIONS[goal.definitionId].version && " (the template has changed since; this run keeps its own copy)"}. Statuses are read from the Task Center on this device.
                </div>
              ) : (
                <div className="muted small">No live run yet. Starting one creates a task per step in the Task Center, with each step's registry agent, building, dependencies and approval rules. Nothing runs until you start it there.</div>
              )}
              {run && <RunExecution run={run} tasks={taskMap} names={names} />}
              {incident ? null : isExecutive ? (
                <p className="muted small">This is an executive goal: its plan starts from Mission Control after you approve it there, so its autonomy level and budget are checked.</p>
              ) : confirming ? (
                <div className="wf-confirm">
                  <span>Create {def.nodes.filter((n) => n.kind !== "outcome").length} tasks in the Task Center?</span>
                  <button className="btn small primary" onClick={start}>
                    Create tasks
                  </button>
                  <button className="btn small" onClick={() => setConfirming(false)}>
                    Cancel
                  </button>
                </div>
              ) : (
                <button className="btn small" onClick={() => setConfirming(true)}>
                  <Icon name="tasks" size={13} /> {run ? "Start another live run" : "Start a live run"}
                </button>
              )}
              {startMsg && <p className="task-error">{startMsg}</p>}
            </div>
          )}
        </div>
      </section>

      <div className="wf-main">
        <section className="card wf-canvas-card" aria-label="Execution canvas">
          <div className="card-head">
            <h2 className="grow">Execution canvas</h2>
            <Legend />
          </div>
          <WorkflowCanvas layout={graph} resolved={resolved} status={status} selectedNode={sel.nodeId} selectedBuilding={sel.buildingId} onPick={pick} />
        </section>

        <aside className="card wf-inspector" aria-label="Inspector">
          {node ? (
            <Inspector
              node={node}
              def={def}
              r={resolved.get(node.id)!}
              status={status.get(node.id) ?? "not_started"}
              task={run && mode === "live" ? taskMap.get(run.nodeTasks[node.id] ?? "") : undefined}
              runError={run && mode === "live" ? run.errors[node.id] : undefined}
              handoff={run && mode === "live" ? ledger?.handoffs[node.id] : undefined}
              allTasks={taskMap}
              events={events.filter((e) => e.nodeId === node.id)}
              names={names}
              onPick={pick}
              onFocus={focusOnMap}
              onOpenTask={openTask}
              mode={mode}
              runId={run && mode === "live" ? run.id : undefined}
            />
          ) : (
            <div className="wf-empty">
              <Icon name="flow" size={22} />
              <p>Select a step to see its agent, building, inputs, dependencies, approvals and history.</p>
            </div>
          )}
        </aside>
      </div>

      <OutputStudio
        mode={mode}
        goal={goal}
        def={def}
        outputs={outputs}
        status={status}
        names={names}
        runLabel={runLabel}
        hasRun={!!run || !!incident}
        selectedNodeId={sel.nodeId}
        onSelect={pickOutput}
        onOpenTask={openTask}
      />

      <div className="wf-lower">
        <section className="card wf-timeline" aria-label="Execution timeline">
          <div className="card-head">
            <h2 className="grow">Execution timeline</h2>
            <span className={`chip${mode === "simulation" ? " wf-chip-sim" : ""}`}>{mode === "simulation" ? "Simulated" : "From Task Center"}</span>
          </div>
          {events.length ? (
            <ol className="wf-events">
              {events
                .slice()
                .reverse()
                .slice(0, 80)
                .map((e) => (
                  <li key={e.id} className={`ev-${e.type}`}>
                    <button className="text-btn wf-ev-node" onClick={() => pick(e.nodeId)}>
                      {def.nodes.find((n) => n.id === e.nodeId)?.title ?? e.nodeId}
                    </button>
                    <span className="wf-ev-text">{e.text}</span>
                    <span className="muted small" title={formatDateTime(e.at)}>
                      {e.simulated ? `T+${Math.round((Date.parse(e.at) - Date.parse(events[0].at)) / 60000)} min` : relative(e.at)}
                      {e.actor ? ` · ${e.actor}` : ""}
                    </span>
                  </li>
                ))}
            </ol>
          ) : (
            <p className="muted small wf-pad">{mode === "simulation" ? "Press Next step to play the simulation." : run ? "No events recorded yet." : "Start a live run to see its events here."}</p>
          )}
        </section>

        <section className="card wf-buildings" aria-label="Buildings">
          <div className="card-head">
            <h2 className="grow">Buildings</h2>
            {sel.buildingId && (
              <button className="text-btn small" onClick={() => selectBuilding(null)}>
                Clear
              </button>
            )}
          </div>
          <ul className="wf-bldg-list">
            {buildings.map((b) => (
              <li key={b.buildingId} className={sel.buildingId === b.buildingId ? "on" : ""}>
                <button className="wf-bldg" onClick={() => selectBuilding(sel.buildingId === b.buildingId ? null : b.buildingId)} aria-pressed={sel.buildingId === b.buildingId}>
                  <span className="wf-bldg-name">{b.buildingName}</span>
                  <span className="muted small">
                    {b.nodeIds.length} step{b.nodeIds.length === 1 ? "" : "s"}
                    {b.active ? ` · ${b.active} active` : ""}
                    {b.waiting ? ` · ${b.waiting} waiting` : ""}
                    {b.done ? ` · ${b.done} done` : ""}
                    {b.failed ? ` · ${b.failed} failed` : ""}
                    {b.unconfigured ? ` · ${b.unconfigured} unconfigured` : ""}
                  </span>
                </button>
                {sel.buildingId === b.buildingId && (
                  <div className="wf-bldg-detail">
                    <ul>
                      {b.nodeIds.map((id) => (
                        <li key={id}>
                          <button className="text-btn small" onClick={() => pick(id)}>
                            {def.nodes.find((n) => n.id === id)?.title}
                          </button>
                          <span className={`wf-tone tone-${statusTone(status.get(id) ?? "not_started")}`}>{NODE_STATUS_LABEL[status.get(id) ?? "not_started"]}</span>
                        </li>
                      ))}
                    </ul>
                    <button className="btn small" onClick={() => focusOnMap(b.buildingId)}>
                      <Icon name="map" size={13} /> Focus on the map
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}

function Legend() {
  return (
    <span className="wf-legend" aria-hidden>
      <span className="tone-run">Running</span>
      <span className="tone-wait">Waiting</span>
      <span className="tone-done">Done</span>
      <span className="tone-bad">Failed</span>
      <span className="tone-unconf">Unconfigured</span>
    </span>
  );
}

interface InspectorProps {
  runId?: string;
  node: WorkflowNode;
  def: WorkflowDefinition;
  r: ResolvedNode;
  status: NodeStatus;
  task?: StoredTask;
  runError?: string;
  allTasks: ReadonlyMap<string, StoredTask>;
  events: ExecutionEvent[];
  names: (id: string) => string;
  onPick: (id: string) => void;
  onFocus: (buildingId: string) => void;
  onOpenTask: (taskId: string) => void;
  mode: RunMode;
  handoff?: HandoffRecord;
}

const HANDOFF_LABEL: Record<HandoffRecord["state"], string> = { validated: "Output validated", unverified: "Completed without structured output (unverified)", waived: "Waived" };

function Inspector({ node, def, r, status, task, runError, allTasks, events, names, onPick, onFocus, onOpenTask, mode, handoff, runId }: InspectorProps) {
  const ups = upstream(def, node.id);
  const downs = downstream(def, node.id);
  const lastAttempt = task?.attempts[task.attempts.length - 1];
  const waitingOn = task ? unmetDependencies(task, allTasks) : [];
  return (
    <div className="wf-insp">
      <div className="wf-insp-head">
        <span className="chip">{node.kind[0].toUpperCase() + node.kind.slice(1)}</span>
        <span className={`wf-tone tone-${statusTone(status)}`}>{NODE_STATUS_LABEL[status]}</span>
        {mode === "simulation" && <span className="chip wf-chip-sim">Simulated</span>}
      </div>
      <h3>{node.title}</h3>
      <p className="muted">{node.summary}</p>

      {node.unconfigured && (
        <div className="task-callout warn">
          <b>Unconfigured</b>
          <span>{node.unconfigured}</span>
        </div>
      )}
      {r.problem && (
        <div className="task-callout warn">
          <b>Registry problem</b>
          <span>{r.problem}</span>
        </div>
      )}

      <dl className="wf-facts">
        <div>
          <dt>Agent</dt>
          <dd>
            {r.agentName ? (
              <>
                {r.agentName}
                {r.catalogName && <span className="muted"> · {r.catalogName}</span>}
                {r.agent && <span className="muted"> · registry status {r.agent.status}</span>}
              </>
            ) : node.kind === "approval" || node.kind === "decision" ? (
              "Khaneil"
            ) : (
              "None configured"
            )}
          </dd>
        </div>
        <div>
          <dt>Building</dt>
          <dd>
            {r.buildingName}
            {r.desk && <span className="muted"> · desk in {r.desk}</span>}
            {r.buildingId && (
              <button className="text-btn small" onClick={() => onFocus(r.buildingId)}>
                Focus on the map
              </button>
            )}
          </dd>
        </div>
        <div>
          <dt>Execution</dt>
          <dd>
            {EXEC_LABEL[node.execution.kind]} · {node.execution.note}
            {r.environment !== "Not documented" && r.agent && <span className="muted"> Environment: {r.environment}.</span>}
          </dd>
        </div>
        {r.workflows.length > 0 && (
          <div>
            <dt>Workflows</dt>
            <dd>
              {r.workflows.map((w) => (
                <div key={`${w.kind}:${w.id}`}>{w.url ? <ExternalLink href={w.url}>{w.label}</ExternalLink> : w.label}</div>
              ))}
            </dd>
          </div>
        )}
        <div>
          <dt>Inputs</dt>
          <dd>{node.inputs.join(" · ") || "None"}</dd>
        </div>
        <div>
          <dt>Outputs</dt>
          <dd>{node.outputs.join(" · ") || "None"}</dd>
        </div>
        <div>
          <dt>Depends on</dt>
          <dd>
            {ups.length
              ? ups.map((u) => (
                  <button key={u} className="text-btn small" onClick={() => onPick(u)}>
                    {def.nodes.find((n) => n.id === u)?.title}
                  </button>
                ))
              : "Nothing: this is where the workflow starts."}
          </dd>
        </div>
        <div>
          <dt>Leads to</dt>
          <dd>
            {downs.length
              ? downs.map((d) => {
                  const e = def.edges.find((x) => x.from === node.id && x.to === d);
                  return (
                    <button key={d} className="text-btn small" onClick={() => onPick(d)}>
                      {e?.label ? `${e.label}: ` : ""}
                      {def.nodes.find((n) => n.id === d)?.title}
                    </button>
                  );
                })
              : "Nothing: this is an end of the workflow."}
          </dd>
        </div>
        <div>
          <dt>Approval</dt>
          <dd>
            {node.approval ? (
              <>
                Khaneil approves each run before it can start ({node.approval.categories.map((c) => CATEGORY_LABEL[c]).join(", ")}). {node.approval.reason} The Task Center enforces it; agents and workflows can't approve.
              </>
            ) : node.kind === "decision" ? (
              "Khaneil decides. Atlas never decides it."
            ) : (
              "None needed."
            )}
          </dd>
        </div>
        {r.capabilities.length > 0 && (
          <div>
            <dt>Registry duties</dt>
            <dd>{r.capabilities.join(" · ")}</dd>
          </div>
        )}
      </dl>
      {node.caveat && <p className="muted small wf-caveat">{node.caveat}</p>}

      {mode === "live" && (
        <div className="wf-insp-live">
          <div className="section-title">Task Center record</div>
          {task ? (
            <>
              <div className="wf-insp-row">
                <span>
                  {STATUS_LABEL[task.status]} · updated {relative(task.updatedAt)}
                </span>
                <button className="btn small" onClick={() => onOpenTask(task.id)}>
                  <Icon name="tasks" size={13} /> Open in Task Center
                </button>
              </div>
              {(() => {
                const tm = stepTiming(task);
                return tm.startedAt ? (
                  <div className="muted small">
                    Ran {formatDateTime(tm.startedAt)}
                    {tm.durationMs !== undefined && ` · took ${Math.max(1, Math.round(tm.durationMs / 1000))} s`} · attempt {task.attempts.length} of {task.maxAttempts}
                  </div>
                ) : null;
              })()}
              {handoff && (
                <div className="muted small">
                  {HANDOFF_LABEL[handoff.state]} · {handoff.output?.schema ?? "no schema"} · by {handoff.by}
                  {handoff.reason && ` · ${handoff.reason}`}
                  {handoff.output?.artifacts.map((a) => (
                    <div key={a.id}>
                      <ExternalLink href={a.url}>{a.label}</ExternalLink>
                    </div>
                  ))}
                </div>
              )}
              {waitingOn.length > 0 && <div className="muted small">Waiting on: {waitingOn.map((id) => allTasks.get(id)?.title ?? id).join(", ")}</div>}
              {(task.error || lastAttempt?.error) && <p className="task-error">{task.error ?? lastAttempt?.error}</p>}
              {task.status === "failed" && <div className="muted small">Retry from the Task Center, which checks attempts left and asks for approval again where the step needs it.</div>}
              {lastAttempt?.externalUrl && <ExternalLink href={lastAttempt.externalUrl}>Latest run</ExternalLink>}
            </>
          ) : runError ? (
            <p className="task-error">No task: {runError}</p>
          ) : node.kind === "outcome" ? (
            <div className="muted small">Outcomes have no task; this one is reached when the steps before it complete.</div>
          ) : (
            <div className="muted small">{task === undefined && "No task found. It may have been removed from the Task Center on this device."}</div>
          )}
        </div>
      )}

      {runId && <NodeBusiness runId={runId} task={task} />}

      <div className="section-title">Execution log</div>
      {events.length ? (
        <ol className="task-events">
          {events.map((e) => (
            <li key={e.id}>
              {e.text}
              <div className="muted small">{e.simulated ? "Simulated" : `${formatDateTime(e.at)}${e.actor ? ` · ${e.actor}` : ""}`}</div>
            </li>
          ))}
        </ol>
      ) : (
        <p className="muted small">{mode === "simulation" ? "Nothing yet at this step." : `No events for ${names(node.id)} yet.`}</p>
      )}
    </div>
  );
}
