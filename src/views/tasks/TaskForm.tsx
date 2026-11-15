import { useMemo, useState } from "react";
import { Icon } from "../../components/Icon";
import { useAtlas } from "../../state";
import { availability, type ExecContext } from "../../tasks/adapters";
import { agentProblem, agentProfiles, taskBuildings } from "../../tasks/registry";
import { ruleRouter } from "../../tasks/routing";
import { editTask, taskService, type NewTask } from "../../tasks/store";
import { CATEGORY_LABEL, KHANEIL, PRIORITY_LABEL, SENSITIVE_CATEGORIES, TASK_PRIORITIES, type SensitiveCategory, type StoredTask, type TaskPriority, type WorkflowRef } from "../../tasks/types";
import { TERMINAL } from "../../tasks/lifecycle";

/** Create a task, or edit one that hasn't run yet (or failed). */
export function TaskForm({ task, preset, ctx, onDone, onClose }: { task?: StoredTask; preset?: { buildingId?: string; agentId?: string }; ctx: ExecContext; onDone: (id: string) => void; onClose: () => void }) {
  const { catalog } = useAtlas();
  const profiles = useMemo(() => agentProfiles(catalog), [catalog]);
  const buildings = useMemo(() => taskBuildings(catalog), [catalog]);
  const all = taskService().repo.list();
  const [title, setTitle] = useState(task?.title ?? "");
  const [description, setDescription] = useState(task?.description ?? "");
  const [objective, setObjective] = useState(task?.objective ?? "");
  const [priority, setPriority] = useState<TaskPriority>(task?.priority ?? "medium");
  const [buildingId, setBuildingId] = useState(task?.buildingId ?? preset?.buildingId ?? "");
  const [agentId, setAgentId] = useState(task?.agentId ?? preset?.agentId ?? "");
  const [workflowKey, setWorkflowKey] = useState(task?.workflow && task.workflow.kind !== "manual" ? `${task.workflow.kind}:${task.workflow.id}` : "manual");
  const [deps, setDeps] = useState<string[]>(task?.dependencyIds ?? []);
  const [requiresApproval, setRequiresApproval] = useState(task?.requiresApproval ?? false);
  const [categories, setCategories] = useState<SensitiveCategory[]>(task?.categories ?? []);
  const [maxAttempts, setMaxAttempts] = useState(task?.maxAttempts ?? 3);
  const [error, setError] = useState<string | null>(null);
  const [routeNote, setRouteNote] = useState<string | null>(null);

  const agent = profiles.find((p) => p.id === agentId);
  const agentChoices = profiles.filter((p) => !buildingId || p.buildingId === buildingId);
  const workflows: WorkflowRef[] = agent?.workflows ?? [];
  const workflow: WorkflowRef | undefined = workflows.find((w) => `${w.kind}:${w.id}` === workflowKey) ?? (workflowKey === "manual" ? { kind: "manual", id: "", label: "Manual work" } : task?.workflow);
  const avail = availability({ workflow, agentId }, ctx);
  const depChoices = all.filter((t) => t.id !== task?.id && (!TERMINAL.has(t.status) || deps.includes(t.id))).slice(0, 60);

  const pickAgent = (id: string) => {
    setAgentId(id);
    const p = profiles.find((x) => x.id === id);
    if (p) setBuildingId(p.buildingId);
    setWorkflowKey(p?.workflows[0] ? `${p.workflows[0].kind}:${p.workflows[0].id}` : "manual");
  };
  const suggest = () => {
    const r = ruleRouter.route({ title, description, source: "manual", buildingId: buildingId || undefined }, profiles);
    if (!r) return setRouteNote("No agent declares a matching capability. Pick one, or leave it unassigned.");
    pickAgent(r.agentId);
    setRouteNote(`Suggested ${profiles.find((p) => p.id === r.agentId)?.name}: ${r.reason}`);
  };

  const save = () => {
    const svc = taskService();
    const fields: NewTask = {
      title,
      description,
      objective,
      priority,
      agentId: agentId || undefined,
      agentName: agent?.name,
      buildingId: buildingId || undefined,
      buildingName: buildings.find((b) => b.id === buildingId)?.name,
      workflow,
      dependencyIds: deps,
      requiresApproval,
      categories,
      maxAttempts,
    };
    const problem = agentId ? agentProblem(catalog.agents.find((a) => a.id === agentId)) : null;
    if (problem && agentId !== task?.agentId) return setError(problem);
    const r = task
      ? svc.apply(task.id, (t, everyone, at) => editTask(t, { ...fields, agentId: fields.agentId ?? "", buildingId: fields.buildingId ?? "" }, everyone, KHANEIL, at, problem))
      : svc.create(fields, KHANEIL);
    if (!r.ok) return setError(r.error);
    onDone(r.task.id);
  };
  const toggleCat = (c: SensitiveCategory) => setCategories((xs) => (xs.includes(c) ? xs.filter((x) => x !== c) : [...xs, c]));

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <aside className="panel task-panel" role="dialog" aria-label={task ? "Edit task" : "New task"}>
        <div className="panel-head">
          <div className="grow">
            <div className="eyebrow">Task Center</div>
            <h2>{task ? "Edit task" : "New task"}</h2>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close" style={{ color: "var(--ink-2)" }}>
            <Icon name="close" />
          </button>
        </div>
        <form
          className="panel-body task-form"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <label className="task-field">
            <span>Title</span>
            <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={160} required autoFocus />
          </label>
          <label className="task-field">
            <span>Description</span>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
          </label>
          <label className="task-field">
            <span>Objective</span>
            <input value={objective} onChange={(e) => setObjective(e.target.value)} placeholder="What done looks like" />
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
              <span>Attempts allowed</span>
              <input type="number" min={1} max={10} value={maxAttempts} onChange={(e) => setMaxAttempts(Number(e.target.value) || 1)} />
            </label>
          </div>
          <label className="task-field">
            <span>Building</span>
            <select
              value={buildingId}
              onChange={(e) => {
                setBuildingId(e.target.value);
                if (agent && e.target.value && agent.buildingId !== e.target.value) pickAgent("");
              }}
            >
              <option value="">No building</option>
              {buildings.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </label>
          <div className="task-field">
            <span>
              Agent <button type="button" className="text-btn small" onClick={suggest}>Suggest from capabilities</button>
            </span>
            <select value={agentId} onChange={(e) => pickAgent(e.target.value)} aria-label="Agent">
              <option value="">Unassigned</option>
              {agentChoices.map((p) => (
                <option key={p.id} value={p.id} disabled={!!p.unavailable && p.id !== task?.agentId}>
                  {p.name}
                  {p.unavailable ? " (retired)" : ""}
                </option>
              ))}
            </select>
            {routeNote && <small className="muted">{routeNote}</small>}
            {agent && (
              <small className="muted">
                Runs on {agent.environment}. {agent.capabilities.length ? `Can: ${agent.capabilities.slice(0, 4).join(" · ")}` : "No capabilities declared in its manifest."}
              </small>
            )}
          </div>
          <label className="task-field">
            <span>Workflow</span>
            <select value={workflowKey} onChange={(e) => setWorkflowKey(e.target.value)}>
              <option value="manual">Manual work (a person does it and records the result)</option>
              {workflows.map((w) => (
                <option key={`${w.kind}:${w.id}`} value={`${w.kind}:${w.id}`}>
                  {w.kind === "n8n" ? `n8n · ${w.label}` : w.label}
                </option>
              ))}
            </select>
          </label>
          <div className={`task-callout ${avail.mode === "execute" ? "good" : avail.mode === "read-only" ? "warn" : ""}`}>
            <b>{avail.mode === "execute" ? "Atlas can start this" : avail.mode === "read-only" ? "Read-only from Atlas" : "Manual work"}</b>
            <span>{avail.mode === "execute" ? avail.note : avail.mode === "read-only" ? `${avail.reason} ${avail.need}` : "Start it here when you begin, then mark it done or failed."}</span>
          </div>
          {depChoices.length > 0 && (
            <fieldset className="task-field task-checks">
              <legend>Depends on</legend>
              {depChoices.map((t) => (
                <label key={t.id}>
                  <input type="checkbox" checked={deps.includes(t.id)} onChange={() => setDeps((d) => (d.includes(t.id) ? d.filter((x) => x !== t.id) : [...d, t.id]))} /> {t.title}
                </label>
              ))}
            </fieldset>
          )}
          <fieldset className="task-field task-checks">
            <legend>Approval</legend>
            <label>
              <input type="checkbox" checked={requiresApproval || categories.length > 0} disabled={categories.length > 0} onChange={(e) => setRequiresApproval(e.target.checked)} /> Needs Khaneil's approval before each run
            </label>
            {SENSITIVE_CATEGORIES.map((c) => (
              <label key={c}>
                <input type="checkbox" checked={categories.includes(c)} onChange={() => toggleCat(c)} /> {CATEGORY_LABEL[c]}
              </label>
            ))}
          </fieldset>
          {error && (
            <p className="task-error" role="alert">
              {error}
            </p>
          )}
          <div className="task-actions">
            <button type="submit" className="btn primary">
              {task ? "Save changes" : "Create task"}
            </button>
            <button type="button" className="btn" onClick={onClose}>
              Cancel
            </button>
          </div>
        </form>
      </aside>
    </>
  );
}
