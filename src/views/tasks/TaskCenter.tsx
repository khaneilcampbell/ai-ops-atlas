import { ownership } from "../../catalog/ownership";
import { useEffect, useMemo, useState } from "react";
import { DatabaseCard } from "./DatabaseCard";
import { TaskIntelligence } from "./TaskIntelligence";
import { actionsApi } from "../../actions/api";
import { useActions } from "../../actions/state";
import { CopyValue, ExternalLink } from "../../components/bits";
import { Icon } from "../../components/Icon";
import { repoData } from "../../lib/derive";
import { isTauri } from "../../lib/env";
import { load, save } from "../../lib/storage";
import { relative } from "../../lib/time";
import { formatDateTime } from "../../lib/timezone";
import { fetchManageData } from "../../manage/data";
import { managedAgent, MANIFEST } from "../../manage/manifest";
import { useN8nRuns } from "../../n8n/runs";
import { useAtlas } from "../../state";
import { availability, githubRunUpdate, matchGithubRun, n8nRunsSince, outcomeToUpdate, type ExecContext } from "../../tasks/adapters";
import { takeTaskFocus } from "../../tasks/focus";
import { githubFailureEvents, intake, n8nFailureEvents } from "../../tasks/intake";
import { approvalFor, beginAttempt, block, cancel, decideApproval, liveAttempt, needsApproval, requestApproval, retry, startProblem, unmetDependencies, updateAttempt } from "../../tasks/lifecycle";
import { agentProblem, agentProfile, agentProfiles, taskBuildings } from "../../tasks/registry";
import { taskAgentProblem } from "../../product/templates";
import { useWorkspace } from "../../product/workspace";
import { ruleRouter } from "../../tasks/routing";
import { EMPTY_FILTER, lastExecution, matches, page, sortTasks, summarize, type TaskFilter } from "../../tasks/select";
import { addArtifact, byId, taskService, useTasks } from "../../tasks/store";
import { ATLAS, CATEGORY_LABEL, KHANEIL, PRIORITY_LABEL, SOURCE_LABEL, STATUS_LABEL, TASK_PRIORITIES, TASK_SOURCES, TASK_STATUSES, type Actor, type StoredTask, type TaskEventType, type TaskStatus } from "../../tasks/types";
import { TaskForm } from "./TaskForm";
import "../../styles/tasks.css";
import { AgentIdentityLine } from "../../components/AgentIdentity";
import { identityFor } from "../../registry/identity";
import { statusFromTask } from "../../registry/agentStatus";

const GITHUB_ACTOR: Actor = { kind: "github", id: "github-actions", name: "GitHub Actions" };
const STATUS_CLASS: Record<TaskStatus, string> = { queued: "idle", running: "active", blocked: "paused", awaiting_approval: "attention", completed: "done", failed: "failed", cancelled: "retired" };
const EVENT_LABEL: Record<TaskEventType, string> = {
  created: "Created",
  edited: "Edited",
  assigned: "Assigned",
  status_changed: "Status changed",
  approval_requested: "Approval requested",
  approval_granted: "Approved",
  approval_rejected: "Approval rejected",
  execution_started: "Run started",
  execution_completed: "Run completed",
  execution_failed: "Run failed",
  retry_requested: "Retry requested",
  cancellation_requested: "Stop requested",
  external_confirmed: "Confirmed by the outside system",
  dependency_blocked: "Blocked by dependencies",
};

function TaskStatusPill({ status }: { status: TaskStatus }) {
  return <span className={`status task-status ${STATUS_CLASS[status]}`}>{STATUS_LABEL[status]}</span>;
}

function storageWorks(): boolean {
  try {
    localStorage.setItem("atlas:tasks-probe", "1");
    localStorage.removeItem("atlas:tasks-probe");
    return true;
  } catch {
    return false;
  }
}

/** Checks GitHub for runs Atlas started, every minute while one is live and the window is visible. */
function useGithubWatcher(tasks: readonly StoredTask[]) {
  const key = tasks
    .filter((t) => liveAttempt(t)?.executor === "github")
    .map((t) => t.id)
    .join();
  useEffect(() => {
    if (!key) return;
    let stopped = false;
    const tick = async () => {
      if (document.visibilityState !== "visible") return;
      const data = await fetchManageData(MANIFEST).catch(() => null);
      if (!data || stopped) return;
      const svc = taskService();
      const claimed = new Set(svc.repo.list().flatMap((t) => t.attempts.map((a) => a.externalId).filter((x): x is string => !!x)));
      for (const t of svc.repo.list()) {
        const a = liveAttempt(t);
        if (!a || a.executor !== "github" || !t.workflow) continue;
        const runs = data.runs[t.workflow.id] ?? [];
        const run = a.externalId ? runs.find((r) => String(r.id) === a.externalId) : matchGithubRun(a, runs, claimed);
        if (!run) continue;
        claimed.add(String(run.id));
        const u = githubRunUpdate(a, run);
        if (u) svc.apply(t.id, (x, _all, at) => updateAttempt(x, a.id, u, GITHUB_ACTOR, at));
      }
    };
    void tick();
    const timer = setInterval(() => void tick(), 60_000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [key]);
}

/** Automated intake: failed n8n runs and failed GitHub runs of catalog agents become tasks. Off by default. */
function AutoIntake() {
  const n8n = useN8nRuns();
  const { catalog, repos } = useAtlas();
  useEffect(() => {
    const events = [...n8nFailureEvents(n8n.value, catalog.agents), ...githubFailureEvents(catalog.agents, repos)];
    if (events.length) intake(taskService(), events, agentProfiles(catalog), ruleRouter, ATLAS);
  }, [n8n.value, repos, catalog]);
  return null;
}

/** Atlas Task Center: create, assign, run and review work across agents and buildings. */
export function TaskCenterView() {
  const tasks = useTasks();
  const { catalog } = useAtlas();
  const actions = useActions();
  const ctx: ExecContext = { desktop: actions.available, agentsToken: !!actions.status?.agents_token };
  const focus = useMemo(() => takeTaskFocus(), []);
  const [filter, setFilterState] = useState<TaskFilter>(() => {
    const { taskId: _task, ...rest } = focus ?? {}; // eslint-disable-line @typescript-eslint/no-unused-vars
    return { ...EMPTY_FILTER, ...rest };
  });
  const [selected, setSelected] = useState<string | null>(focus?.taskId ?? null);
  const [form, setForm] = useState<{ task?: StoredTask; preset?: { buildingId?: string; agentId?: string } } | null>(null);
  const [pageN, setPage] = useState(0);
  const [autoIntake, setAutoIntake] = useState(() => load<boolean>("tasksAutoIntake", false));
  const [storageOk] = useState(storageWorks);
  useGithubWatcher(tasks);

  const setFilter = (f: Partial<TaskFilter>) => {
    setFilterState((x) => ({ ...x, ...f }));
    setPage(0);
  };
  const summary = useMemo(() => summarize(tasks), [tasks]);
  const filtered = useMemo(() => sortTasks(tasks.filter((t) => matches(t, filter))), [tasks, filter]);
  const paged = page(filtered, pageN);
  const profiles = useMemo(() => agentProfiles(catalog), [catalog]);
  const buildings = useMemo(() => taskBuildings(catalog), [catalog]);
  const nameOfBuilding = (t: StoredTask) => (t.buildingId ? (catalog.projects.find((p) => p.id === t.buildingId)?.name ?? t.buildingName ?? t.buildingId) : "—");
  const nameOfAgent = (t: StoredTask) => (t.agentId ? (catalog.agents.find((a) => a.id === t.agentId)?.name ?? t.agentName ?? t.agentId) : "Unassigned");
  const filtering = JSON.stringify(filter) !== JSON.stringify(EMPTY_FILTER);
  const tile = (label: string, n: number, f: Partial<TaskFilter>, sub: string, tone = "") => (
    <button className={`card tile ${tone}`} onClick={() => setFilter({ ...EMPTY_FILTER, ...f })} aria-label={`${label}: ${n}. Show these tasks.`}>
      <div className="eyebrow">{label}</div>
      <div className="num">{n}</div>
      <div className="sub">{sub}</div>
    </button>
  );
  const scope = isTauri() ? "Saved on this Mac only" : "Saved in this browser only";

  return (
    <div className="page task-center">
      {autoIntake && <AutoIntake />}
      <div className="page-head">
        <div className="grow">
          <div className="eyebrow">Task Center</div>
          <h1>Work, owners and runs in one place.</h1>
          <p className="lede">Create tasks, give them to Atlas agents and buildings, and follow each run, approval and result. Status changes follow fixed rules; no model is called to manage them.</p>
        </div>
        <button className="btn primary" onClick={() => setForm({ preset: { buildingId: filter.building || undefined, agentId: filter.agent || undefined } })} disabled={!storageOk}>
          <Icon name="plus" size={14} /> New task
        </button>
      </div>

      <IntegrationStrip ctx={ctx} scope={scope} storageOk={storageOk} autoIntake={autoIntake} setAutoIntake={(v) => { setAutoIntake(v); save("tasksAutoIntake", v); }} />

      <div className="tiles task-kpis">
        {tile("Total tasks", summary.total, {}, "Everything on this device")}
        {tile("Running", summary.running, { status: "running" }, "Started, not finished", summary.running ? "accent" : "")}
        {tile("Queued", summary.queued, { status: "queued" }, "Ready to start")}
        {tile("Awaiting approval", summary.awaitingApproval, { status: "awaiting_approval" }, "Needs Khaneil", summary.awaitingApproval ? "warn" : "")}
        {tile("Failed", summary.failed, { status: "failed" }, "Retry or close", summary.failed ? "bad" : "")}
        {tile("Completed · 24h", summary.completed24h, { status: "completed" }, "Finished in the last day")}
      </div>

      <div className="filters task-filters" role="search">
        <label className="field">
          <Icon name="search" size={14} />
          <input value={filter.query} onChange={(e) => setFilter({ query: e.target.value })} placeholder="Search tasks" aria-label="Search tasks" />
        </label>
        <Select label="Status" value={filter.status} onChange={(v) => setFilter({ status: v as TaskFilter["status"] })} options={[["open", "Open"], ...TASK_STATUSES.map((s) => [s, STATUS_LABEL[s]] as [string, string])]} />
        <Select label="Priority" value={filter.priority} onChange={(v) => setFilter({ priority: v as TaskFilter["priority"] })} options={TASK_PRIORITIES.map((p) => [p, PRIORITY_LABEL[p]])} />
        <Select label="Agent" value={filter.agent} onChange={(v) => setFilter({ agent: v })} options={profiles.map((p) => [p.id, p.name])} />
        <Select label="Building" value={filter.building} onChange={(v) => setFilter({ building: v })} options={buildings.map((b) => [b.id, b.name])} />
        <Select label="Source" value={filter.source} onChange={(v) => setFilter({ source: v as TaskFilter["source"] })} options={TASK_SOURCES.map((s) => [s, SOURCE_LABEL[s]])} />
        <label className="field">
          <span>From</span>
          <input type="date" value={filter.from} onChange={(e) => setFilter({ from: e.target.value })} aria-label="Created from" />
        </label>
        <label className="field">
          <span>To</span>
          <input type="date" value={filter.to} onChange={(e) => setFilter({ to: e.target.value })} aria-label="Created to" />
        </label>
        {filtering && (
          <button className="text-btn" onClick={() => setFilter(EMPTY_FILTER)}>
            Clear filters
          </button>
        )}
        <span className="count">
          {filtered.length} of {tasks.length}
        </span>
      </div>

      {!storageOk ? (
        <div className="card card-pad task-empty" role="alert">
          <h3>Tasks can't be saved here</h3>
          <p className="muted">This window's local storage is blocked or full, so the Task Center can't keep tasks. Nothing was lost; open Atlas in the Mac app or a normal browser window.</p>
        </div>
      ) : tasks.length === 0 ? (
        <div className="card card-pad task-empty">
          <h3>No tasks yet</h3>
          <p className="muted">Create one and give it to an agent, or switch on “Create tasks from failed runs” above to let Atlas file failures for you.</p>
          <button className="btn primary" onClick={() => setForm({})}>
            <Icon name="plus" size={14} /> New task
          </button>
        </div>
      ) : filtered.length === 0 ? (
        <div className="card card-pad task-empty">
          <h3>No tasks match</h3>
          <button className="text-btn" onClick={() => setFilter(EMPTY_FILTER)}>
            Clear filters
          </button>
        </div>
      ) : (
        <div className="card task-table-card">
          <table className="table task-table">
            <thead>
              <tr>
                <th>Task</th>
                <th>Status</th>
                <th>Priority</th>
                <th>Agent</th>
                <th>Building</th>
                <th>Source</th>
                <th>Created</th>
                <th>Last run</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {paged.rows.map((t) => (
                <tr key={t.id} className={selected === t.id ? "selected" : undefined} onClick={() => setSelected(t.id)}>
                  <td data-label="Task">
                    <button className="text-btn inline name task-title" onClick={(e) => { e.stopPropagation(); setSelected(t.id); }}>
                      {t.title}
                    </button>
                    {t.description && <div className="desc">{t.description}</div>}
                  </td>
                  <td data-label="Status">
                    <TaskStatusPill status={t.status} />
                    {t.cancelRequestedAt && <div className="desc">Stop requested</div>}
                  </td>
                  <td data-label="Priority">
                    <span className={`task-priority ${t.priority}`}>{PRIORITY_LABEL[t.priority]}</span>
                  </td>
                  <td data-label="Agent">{t.agentId ? <AgentIdentityLine identity={identityFor(t.agentId, catalog.agents, t.agentName)} status={statusFromTask(t.status)} size={26} /> : nameOfAgent(t)}</td>
                  <td data-label="Building">{nameOfBuilding(t)}</td>
                  <td data-label="Source">
                    {SOURCE_LABEL[t.source]}
                    {t.workflow && t.workflow.kind !== "manual" && <div className="desc">{t.workflow.kind === "n8n" ? "n8n" : "GitHub"} workflow</div>}
                  </td>
                  <td data-label="Created" title={formatDateTime(t.createdAt)}>{relative(t.createdAt)}</td>
                  <td data-label="Last run" title={lastExecution(t) ? formatDateTime(lastExecution(t)!) : undefined}>{lastExecution(t) ? relative(lastExecution(t)!) : "Never"}</td>
                  <td data-label="">
                    <button className="text-btn small" onClick={(e) => { e.stopPropagation(); setSelected(t.id); }}>
                      Open ›
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {paged.pages > 1 && (
            <div className="card-foot task-pager">
              <button className="text-btn" disabled={paged.page === 0} onClick={() => setPage(paged.page - 1)}>
                ‹ Previous
              </button>
              <span className="muted small">
                Page {paged.page + 1} of {paged.pages}
              </span>
              <button className="text-btn" disabled={paged.page >= paged.pages - 1} onClick={() => setPage(paged.page + 1)}>
                Next ›
              </button>
            </div>
          )}
        </div>
      )}

      <DatabaseCard />

      {selected && tasks.some((t) => t.id === selected) && !form && <TaskDetail id={selected} ctx={ctx} onClose={() => setSelected(null)} onEdit={(task) => setForm({ task })} onOpen={setSelected} />}
      {form && (
        <TaskForm
          task={form.task}
          preset={form.preset}
          ctx={ctx}
          onClose={() => setForm(null)}
          onDone={(id) => {
            setForm(null);
            setSelected(id);
          }}
        />
      )}
    </div>
  );
}

function Select({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: [string, string][] }) {
  return (
    <label className="field">
      <span>{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">All</option>
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </label>
  );
}

/** What is connected, in one line each: where tasks are kept, what GitHub and n8n can do from here. */
function IntegrationStrip({ ctx, scope, storageOk, autoIntake, setAutoIntake }: { ctx: ExecContext; scope: string; storageOk: boolean; autoIntake: boolean; setAutoIntake: (v: boolean) => void }) {
  const n8n = useN8nRuns();
  const github = ctx.desktop ? (ctx.agentsToken ? { tone: "good", text: "Can start allow-listed agents (Touch ID)" } : { tone: "warn", text: "Read-only: no Manage agents token" }) : { tone: "warn", text: "Read-only on the web" };
  const n8nLine =
    n8n.state === "ready" && n8n.value?.state === "ok"
      ? { tone: "good", text: `Reading runs, read-only · ${n8n.value.workflows.length} workflows` }
      : n8n.state === "ready" && n8n.value?.state === "not-configured"
        ? { tone: "bad", text: `Not configured: ${n8n.value.need}` }
        : n8n.state === "error"
          ? { tone: "bad", text: `Disconnected: ${n8n.message}` }
          : n8n.state === "off"
            ? { tone: "warn", text: "Read only by the Mac app and hosted site" }
            : { tone: "", text: "Checking…" };
  return (
    <div className="task-strip" aria-label="Connections">
      <span className={`task-conn ${storageOk ? "warn" : "bad"}`} title="Tasks are kept in this device's local storage and are not synced to other devices yet.">
        <span className="dot" /> <b>Storage</b> {storageOk ? scope : "Unavailable"}
      </span>
      <span className={`task-conn ${github.tone}`}>
        <span className="dot" /> <b>GitHub</b> {github.text}
      </span>
      <span className={`task-conn ${n8nLine.tone}`} title={n8n.message ?? undefined}>
        <span className="dot" /> <b>n8n</b> {n8nLine.text}
      </span>
      <label className="task-conn task-toggle">
        <input type="checkbox" checked={autoIntake} onChange={(e) => setAutoIntake(e.target.checked)} /> Create tasks from failed runs
      </label>
    </div>
  );
}

function Kv({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </>
  );
}

function TaskDetail({ id, ctx, onClose, onEdit, onOpen }: { id: string; ctx: ExecContext; onClose: () => void; onEdit: (t: StoredTask) => void; onOpen: (id: string) => void }) {
  const tasks = useTasks();
  const { catalog, repos, select, setView } = useAtlas();
  const workspace = useWorkspace();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [failNote, setFailNote] = useState("");
  const [artLabel, setArtLabel] = useState("");
  const [artUrl, setArtUrl] = useState("");
  const all = useMemo(() => byId(tasks), [tasks]);
  const task = all.get(id);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  if (!task) return null;

  const svc = taskService();
  const catalogAgent = task.agentId ? catalog.agents.find((a) => a.id === task.agentId) : undefined;
  const profile = catalogAgent ? agentProfile(catalogAgent, catalog.projects, ownership(catalog).owned.get(catalogAgent.id)) : null;
  // The registry (retired or removed agents) first, then the active workspace (agent turned off).
  const problemForAgent = task.agentId ? (agentProblem(catalogAgent) ?? taskAgentProblem(task.agentId, workspace, catalog)) : null;
  const avail = availability(task, ctx);
  const live = liveAttempt(task);
  const startBlock = task.status === "queued" ? startProblem(task, all, problemForAgent) : null;
  const managed = task.agentId ? managedAgent(task.agentId) : undefined;
  const run = (fn: Parameters<typeof svc.apply>[1], done?: string) => {
    const r = svc.apply(task.id, fn);
    setMessage(r.ok ? (done ? { ok: true, text: done } : null) : { ok: false, text: r.error });
    return r;
  };

  const start = async () => {
    setMessage(null);
    if (unmetDependencies(task, all).length) return void run((t, everyone, at) => block(t, everyone, KHANEIL, at), "Blocked until its dependencies complete.");
    if (needsApproval(task) && approvalFor(task) !== "granted") return void run((t, _a, at) => requestApproval(t, KHANEIL, at), "Approval requested.");
    const executor = avail.mode === "execute" ? "github" : "manual";
    const r = run((t, everyone, at) => beginAttempt(t, everyone, executor, KHANEIL, at, problemForAgent));
    if (!r.ok || executor !== "github" || !task.agentId || !task.workflow) return;
    const attempt = liveAttempt(r.task)!;
    setBusy(true);
    try {
      const data = await fetchManageData(MANIFEST);
      const state = data.workflows?.[task.workflow.id]?.state ?? null;
      const outcome = await actionsApi.agentAction(task.agentId, "run_now", state);
      const u = outcomeToUpdate(outcome);
      run((t, _a, at) => updateAttempt(t, attempt.id, u, GITHUB_ACTOR, at), outcome.stage === "started" ? "Started on GitHub. Atlas checks the run every minute while this window is open." : undefined);
      if (outcome.stage !== "started") setMessage({ ok: false, text: outcome.message || "Not started." });
    } catch (e) {
      run((t, _a, at) => updateAttempt(t, attempt.id, { state: "unknown", error: `The Mac app didn't answer clearly: ${e instanceof Error ? e.message : String(e)}` }, GITHUB_ACTOR, at));
    } finally {
      setBusy(false);
    }
  };

  const ghRuns = task.workflow?.kind === "github" && task.workflow.repository ? (repoData(repos[task.workflow.repository])?.workflowRuns?.[task.workflow.id] ?? []).slice(0, 3) : [];

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <aside className="panel task-panel" role="dialog" aria-label="Task details">
        <div className="panel-head">
          <div className="grow">
            <div className="eyebrow">Task · {SOURCE_LABEL[task.source]}</div>
            <h2>{task.title}</h2>
            <div className="chips" style={{ marginTop: 10 }}>
              <TaskStatusPill status={task.status} />
              <span className={`chip task-priority ${task.priority}`}>{PRIORITY_LABEL[task.priority]} priority</span>
              {needsApproval(task) && <span className="chip">Approval each run</span>}
              {task.cancelRequestedAt && <span className="chip chip-bad">Stop requested</span>}
            </div>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close task" style={{ color: "var(--ink-2)" }}>
            <Icon name="close" />
          </button>
        </div>
        <div className="panel-body selectable">
          <div className="task-actions">
            {task.status === "queued" && (
              <button className="btn primary" disabled={busy} onClick={() => void start()} title={startBlock ?? undefined}>
                <Icon name="play" size={13} /> {busy ? "Waiting for approval on the Mac…" : unmetDependencies(task, all).length ? "Start (will wait)" : needsApproval(task) && approvalFor(task) !== "granted" ? "Request approval" : avail.mode === "execute" ? "Run on GitHub" : "Start (manual)"}
              </button>
            )}
            {task.status === "awaiting_approval" && (
              <>
                <button className="btn primary" onClick={() => run((t, _a, at) => decideApproval(t, "granted", KHANEIL, at), "Approved for the next run.")}>
                  <Icon name="check" size={13} /> Approve next run
                </button>
                <button className="btn" onClick={() => run((t, _a, at) => decideApproval(t, "rejected", KHANEIL, at), "Rejected; the task is cancelled.")}>
                  Reject
                </button>
              </>
            )}
            {task.status === "running" && live?.executor === "manual" && (
              <>
                <button className="btn primary" onClick={() => run((t, _a, at) => updateAttempt(t, live.id, { state: "succeeded" }, KHANEIL, at), "Marked completed.")}>
                  <Icon name="check" size={13} /> Mark completed
                </button>
                <input className="task-inline-input" value={failNote} onChange={(e) => setFailNote(e.target.value)} placeholder="What went wrong" aria-label="Failure note" />
                <button className="btn" onClick={() => run((t, _a, at) => updateAttempt(t, live.id, { state: "failed", error: failNote.trim() || "Marked failed by Khaneil." }, KHANEIL, at), "Marked failed.")}>
                  Mark failed
                </button>
              </>
            )}
            {task.status === "failed" && (
              <button className="btn primary" disabled={task.attempts.length >= task.maxAttempts} onClick={() => run((t, _a, at) => retry(t, KHANEIL, at), "Back in the queue.")} title={task.attempts.length >= task.maxAttempts ? "All attempts used" : undefined}>
                <Icon name="refresh" size={13} /> Retry ({task.attempts.length}/{task.maxAttempts} used)
              </button>
            )}
            {(task.status === "queued" || task.status === "blocked" || task.status === "failed") && (
              <button className="btn" onClick={() => onEdit(task)}>
                Edit
              </button>
            )}
            {(task.status === "queued" || task.status === "blocked" || task.status === "awaiting_approval" || (task.status === "running" && !task.cancelRequestedAt)) && (
              <button className="btn" onClick={() => run((t, _a, at) => cancel(t, KHANEIL, at), live && live.executor !== "manual" ? "Stop requested. It shows as cancelled once GitHub confirms." : "Cancelled.")}>
                {task.status === "running" && live && live.executor !== "manual" ? "Request stop" : "Cancel task"}
              </button>
            )}
          </div>
          {startBlock && task.status === "queued" && <p className="muted small task-note">{startBlock}</p>}
          {task.cancelRequestedAt && live?.externalUrl && (
            <p className="small task-note">
              Atlas can't stop a GitHub run itself. <ExternalLink href={live.externalUrl}>Cancel it on GitHub</ExternalLink>; the task updates when GitHub reports it cancelled.
            </p>
          )}
          {message && (
            <p className={`small ${message.ok ? "manage-ok" : "task-error"}`} role="status">
              {message.text}
            </p>
          )}

          {(task.description || task.objective) && (
            <section>
              {task.description && <p style={{ margin: 0, fontSize: 14, whiteSpace: "pre-wrap" }}>{task.description}</p>}
              {task.objective && (
                <p className="small" style={{ marginBottom: 0 }}>
                  <b>Objective:</b> {task.objective}
                </p>
              )}
            </section>
          )}

          <section>
            <div className="section-title">Assignment</div>
            <dl className="kv">
              <Kv label="Agent">
                {task.agentId ? (
                  <>
                    {catalogAgent ? (
                      <button className="text-btn inline agent-identity-btn" onClick={() => select({ kind: "agent", id: catalogAgent.id })}>
                        <AgentIdentityLine identity={identityFor(catalogAgent.id, catalog.agents, task.agentName)} status={statusFromTask(task.status)} size={36} />
                      </button>
                    ) : (
                      <AgentIdentityLine identity={identityFor(task.agentId, catalog.agents, task.agentName)} size={36} />
                    )}
                    {problemForAgent && <div className="muted small">{problemForAgent}</div>}
                  </>
                ) : (
                  "Unassigned"
                )}
              </Kv>
              {profile && <Kv label="Capabilities">{profile.capabilities.length ? `${profile.capabilities.slice(0, 4).join(" · ")}${profile.capabilities.length > 4 ? ` · and ${profile.capabilities.length - 4} more` : ""}` : "None declared in its manifest"}</Kv>}
              {profile && <Kv label="Runs on">{profile.environment}</Kv>}
              <Kv label="Building">
                {task.buildingId ? (
                  <button
                    className="text-btn inline"
                    onClick={() => {
                      select({ kind: "project", id: task.buildingId! });
                      setView("map");
                    }}
                  >
                    {catalog.projects.find((p) => p.id === task.buildingId)?.name ?? task.buildingName ?? task.buildingId} · show on map
                  </button>
                ) : (
                  "—"
                )}
              </Kv>
              <Kv label="Workflow">{task.workflow && task.workflow.kind !== "manual" ? task.workflow.url ? <ExternalLink href={task.workflow.url}>{task.workflow.label}</ExternalLink> : task.workflow.label : "Manual work"}</Kv>
              <Kv label="Dependencies">
                {task.dependencyIds.length ? (
                  <ul className="task-deps">
                    {task.dependencyIds.map((d) => (
                      <li key={d}>
                        {all.get(d) ? (
                          <button className="text-btn inline" onClick={() => onOpen(d)}>
                            {all.get(d)!.title}
                          </button>
                        ) : (
                          d
                        )}{" "}
                        <span className="muted small">{all.get(d) ? STATUS_LABEL[all.get(d)!.status] : "deleted"}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  "None"
                )}
              </Kv>
              <Kv label="Created">
                {formatDateTime(task.createdAt)} by {task.createdBy.name}
              </Kv>
              {task.startedAt && <Kv label="Started">{formatDateTime(task.startedAt)}</Kv>}
              {task.completedAt && <Kv label="Finished">{formatDateTime(task.completedAt)}</Kv>}
              <Kv label="Task id">
                <CopyValue value={task.id} mono />
              </Kv>
            </dl>
          </section>

          <section>
            <div className="section-title">Execution</div>
            <div className={`task-callout ${avail.mode === "execute" ? "good" : avail.mode === "read-only" ? "warn" : ""}`}>
              <b>{avail.mode === "execute" ? "Atlas can start this" : avail.mode === "read-only" ? "Read-only from Atlas" : "Manual work"}</b>
              <span>{avail.mode === "execute" ? avail.note : avail.mode === "read-only" ? `${avail.reason} ${avail.need}` : "Start it here when you begin, then mark it completed or failed."}</span>
            </div>
            {task.attempts.length > 0 ? (
              <ul className="list task-attempts">
                {[...task.attempts].reverse().map((a) => (
                  <li key={a.id} className="list-row">
                    <span className="grow">
                      <b>Attempt {a.number}</b> · {a.executor === "manual" ? "manual" : a.executor === "github" ? "GitHub" : "n8n"} · {a.state.replace("_", " ")}
                      <div className="meta">
                        Asked {formatDateTime(a.requestedAt)} by {a.requestedBy.name}
                        {a.finishedAt ? ` · ended ${relative(a.finishedAt)}` : ""}
                        {a.auditId ? ` · Mac audit ${a.auditId}` : ""}
                      </div>
                      {a.error && <div className="task-error small">{a.error}</div>}
                    </span>
                    {a.externalUrl && <ExternalLink href={a.externalUrl}>Run {a.externalId} ↗</ExternalLink>}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted small">Not run yet.</p>
            )}
            {ghRuns.length > 0 && (
              <>
                <div className="section-title" style={{ marginTop: 12 }}>
                  Latest runs of {task.workflow!.id} on GitHub
                </div>
                <ul className="list">
                  {ghRuns.map((r) => (
                    <li key={r.url} className="list-row">
                      <span className="grow">
                        {r.status === "completed" ? (r.conclusion ?? "unknown").replace(/_/g, " ") : r.status.replace(/_/g, " ")} · {r.event.replace(/_/g, " ")}
                        <div className="meta">{formatDateTime(r.createdAt)}</div>
                      </span>
                      <ExternalLink href={r.url}>Open ↗</ExternalLink>
                    </li>
                  ))}
                </ul>
              </>
            )}
            {task.workflow?.kind === "n8n" && <N8nContext workflowId={task.workflow.id} since={task.startedAt} />}
          </section>

          {task.approvals.length > 0 && (
            <section>
              <div className="section-title">Approvals</div>
              {task.categories.length > 0 && <p className="small muted" style={{ marginTop: 0 }}>Sensitive: {task.categories.map((c) => CATEGORY_LABEL[c]).join(", ")}</p>}
              <ul className="list">
                {[...task.approvals].reverse().map((a) => (
                  <li key={a.id} className="list-row">
                    <span className="grow">
                      {a.decision === "requested" ? "Requested" : a.decision === "granted" ? "Approved" : "Rejected"} for attempt {a.forAttempt} by {a.actor.name}
                      <div className="meta">
                        {formatDateTime(a.at)}
                        {a.reason ? ` · ${a.reason}` : ""}
                      </div>
                    </span>
                  </li>
                ))}
              </ul>
              <p className="muted small">Approvals here are recorded on this device. GitHub runs are approved again with Touch ID in the Mac app before anything is sent.</p>
            </section>
          )}

          <section>
            <div className="section-title">Results and artifacts</div>
            {task.error && <p className="task-error small">{task.error}</p>}
            {task.result !== undefined && <pre className="task-result">{typeof task.result === "string" ? task.result : JSON.stringify(task.result, null, 2)}</pre>}
            {task.artifacts.length > 0 && (
              <div className="link-list">
                {task.artifacts.map((a) => (
                  <ExternalLink key={a.id} href={a.url}>
                    <Icon name="external" size={14} /> {a.label}
                  </ExternalLink>
                ))}
              </div>
            )}
            <form
              className="task-artifact-form"
              onSubmit={(e) => {
                e.preventDefault();
                const r = run((t, _a, at) => addArtifact(t, artLabel, artUrl, KHANEIL, at), "Link saved.");
                if (r.ok) {
                  setArtLabel("");
                  setArtUrl("");
                }
              }}
            >
              <input value={artLabel} onChange={(e) => setArtLabel(e.target.value)} placeholder="Label" aria-label="Artifact label" />
              <input value={artUrl} onChange={(e) => setArtUrl(e.target.value)} placeholder="https://…" aria-label="Artifact link" required />
              <button className="btn" type="submit">
                Add link
              </button>
            </form>
          </section>

          <section>
            <div className="section-title">AI usage and cost</div>
            {task.usage.length ? (
              <ul className="list">
                {task.usage.map((u, i) => (
                  <li key={i} className="list-row">
                    <span className="grow">
                      {u.provider} · {u.model}
                      <div className="meta">
                        {u.totalTokens ?? (u.inputTokens ?? 0) + (u.outputTokens ?? 0)} tokens{u.cost ? ` · $${u.cost.usd.toFixed(4)} ${u.cost.basis === "billed" ? "billed" : "estimated"}` : ""}
                      </div>
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted small" style={{ margin: 0 }}>
                No usage reported for this task's runs. Atlas doesn't call a model to estimate it.
                {catalogAgent?.model ? ` The agent uses ${catalogAgent.model}.` : ""}
                {managed?.cap ? ` Its monthly cap is $${managed.cap.usd.toFixed(2)} (Manage agents).` : ""} Billed spend is in API Usage.
              </p>
            )}
          </section>

          <TaskIntelligence task={task} />

          <section>
            <div className="section-title">History</div>
            <ol className="task-events">
              {[...task.events].reverse().map((e) => (
                <li key={e.id}>
                  <b>{EVENT_LABEL[e.type]}</b>
                  {e.type === "status_changed" && e.meta?.from ? ` · ${STATUS_LABEL[e.meta.from as TaskStatus] ?? e.meta.from} → ${STATUS_LABEL[e.meta.to as TaskStatus] ?? e.meta.to}` : ""}
                  {e.meta?.error ? ` · ${e.meta.error}` : e.meta?.reason ? ` · ${e.meta.reason}` : ""}
                  <div className="meta muted small">
                    {formatDateTime(e.at)} · {e.actor.kind === "agent" ? <ActorIdentity id={e.actor.id} name={e.actor.name} /> : e.actor.name}
                  </div>
                </li>
              ))}
            </ol>
            {task.eventsTrimmed > 0 && <p className="muted small">{task.eventsTrimmed} older events were trimmed to keep history small.</p>}
          </section>
        </div>
      </aside>
    </>
  );
}

/** An agent named in task history, with its portrait, so updates are attributed to it. */
function ActorIdentity({ id, name }: { id: string; name: string }) {
  const { catalog } = useAtlas();
  return <AgentIdentityLine identity={identityFor(id, catalog.agents, name)} size={20} showRole={false} />;
}

/** n8n runs of the task's workflow since it started: context only, never claimed as the task's own run. */
function N8nContext({ workflowId, since }: { workflowId: string; since?: string }) {
  const n8n = useN8nRuns();
  if (n8n.state !== "ready" || n8n.value?.state !== "ok") return <p className="muted small">{n8n.state === "error" ? `n8n runs unavailable: ${n8n.message}` : n8n.value?.state === "not-configured" ? `n8n isn't configured: ${n8n.value.need}` : (n8n.message ?? "Reading n8n…")}</p>;
  const wf = n8n.value.workflows.find((w) => w.id === workflowId);
  if (!wf) return <p className="muted small">n8n doesn't list this workflow (archived or deleted).</p>;
  const recent = since ? n8nRunsSince(wf.runs, since) : wf.runs.slice(0, 3);
  return (
    <>
      <div className="section-title" style={{ marginTop: 12 }}>
        {since ? "n8n runs since this task started" : "Latest n8n runs"} · {wf.active ? "published" : "draft"}
      </div>
      {recent.length ? (
        <ul className="list">
          {recent.map((r) => (
            <li key={r.id} className="list-row">
              <span className="grow">
                Execution {r.id} · {r.status}
                <div className="meta">{r.startedAt ? formatDateTime(r.startedAt) : "No start time"} · {r.mode ?? "unknown trigger"}</div>
              </span>
              <ExternalLink href={`${n8n.value!.state === "ok" ? n8n.value!.instance : ""}/workflow/${workflowId}/executions/${r.id}`}>Open ↗</ExternalLink>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted small">None yet.</p>
      )}
      <p className="muted small">Shown for context. Atlas can't tell which execution belongs to this task, so it never marks the task done from n8n by itself.</p>
    </>
  );
}
