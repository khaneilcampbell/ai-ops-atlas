import { useMemo, useRef, useState, type ReactNode } from "react";
import type { Catalog } from "../../catalog/types";
import { Icon } from "../../components/Icon";
import { relative } from "../../lib/time";
import { CATEGORY_LABEL, SENSITIVE_CATEGORIES } from "../../tasks/types";
import {
  addStep,
  availableOutputs,
  draftDefinition,
  draftFromDefinition,
  FAILURE_BEHAVIORS,
  FAILURE_LABEL,
  moveStep,
  previewDraft,
  removeStep,
  sameSteps,
  toggleHandoff,
  updateStep,
  type DesignStep,
  type DraftProblem,
  type WorkflowDraft,
} from "../../workflows/design";
import { draftStore, useDrafts } from "../../workflows/drafts";
import { resolveAll } from "../../workflows/engine";
import { layout as layoutOf } from "../../workflows/graph";
import type { Goal, NodeStatus, WorkflowDefinition } from "../../workflows/types";
import { WorkflowCanvas, type CanvasNote } from "./WorkflowCanvas";

// Design mode of Workflow Intelligence: edit a draft of the selected goal's workflow on the same
// execution canvas, then check it with Preview. A draft is saved on this device only. It never
// changes the template, Run mode or a live run, and nothing here calls a workflow or a service.

type Selection = { kind: "step"; id: string } | { kind: "handoff"; id: string } | null;

const KIND_LABEL: Record<DesignStep["kind"], string> = { agent: "Agent step", approval: "Approval checkpoint", outcome: "Completion" };

interface Props {
  goal: Goal;
  template: WorkflowDefinition;
  catalog: Catalog;
  goalPicker: ReactNode;
}

export function WorkflowDesigner({ goal, template, catalog, goalPicker }: Props) {
  const drafts = useDrafts();
  const saved = drafts[template.id];
  const seed = useMemo(() => draftFromDefinition(template, goal.id), [template, goal.id]);
  const [work, setWork] = useState<WorkflowDraft>(() => saved ?? seed.draft);
  const [sel, setSel] = useState<Selection>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const previewRef = useRef<HTMLElement>(null);

  const def = useMemo(() => draftDefinition(work), [work]);
  const graph = useMemo(() => layoutOf(def), [def]);
  const resolved = useMemo(() => resolveAll(def, catalog), [def, catalog]);
  const preview = useMemo(() => previewDraft(work, catalog), [work, catalog]);
  const status = useMemo(() => new Map<string, NodeStatus>(work.steps.map((s) => [s.id, "not_started"])), [work.steps]);
  const notes = useMemo(() => {
    const m = new Map<string, CanvasNote>();
    for (const s of work.steps) {
      const n = preview.problems.filter((p) => p.stepId === s.id).length;
      if (n) m.set(s.id, { text: `${n} thing${n === 1 ? "" : "s"} to fix`, tone: "bad" });
      else if (s.kind === "approval") m.set(s.id, { text: "Khaneil approves", tone: "wait" });
      else if (s.kind === "outcome") m.set(s.id, { text: "Completion", tone: "done" });
      else m.set(s.id, { text: `→ ${s.outputs.find((o) => o.trim()) ?? ""}`, tone: "idle" });
    }
    return m;
  }, [work.steps, preview.problems]);

  const dirty = !sameSteps(work, saved ?? seed.draft);
  const step = sel?.kind === "step" ? work.steps.find((s) => s.id === sel.id) : undefined;
  const handoffTo = sel?.kind === "handoff" ? work.steps.find((s) => `handoff:${s.id}` === sel.id) : undefined;
  const edit = (next: WorkflowDraft) => {
    setWork(next);
    setMsg(null);
  };

  const add = (kind: "agent" | "approval") => {
    const r = addStep(work, kind, step && step.kind !== "outcome" ? step.id : null);
    edit(r.draft);
    setSel({ kind: "step", id: r.id });
  };
  const save = () => {
    const r = draftStore().save(work);
    if (r.draft) setWork(r.draft);
    setMsg(r.error ?? `Saved as draft revision ${r.draft!.revision}. The template is unchanged.`);
  };
  const startOver = () => {
    const err = draftStore().discard(template.id);
    setConfirmReset(false);
    if (err) return setMsg(err);
    setWork(seed.draft);
    setSel(null);
    setMsg("Draft removed. Design mode shows the template again.");
  };
  const runPreview = () => {
    setShowPreview(true);
    requestAnimationFrame(() => previewRef.current?.scrollIntoView({ block: "start", behavior: "smooth" }));
  };

  return (
    <>
      <section className="card wf-goal" aria-label="Goal">
        <div className="wf-goal-main">
          {goalPicker}
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
                {template.name} · v{template.version} · {template.nodes.length} steps · unchanged by drafts
              </dd>
            </div>
            <div>
              <dt>Draft</dt>
              <dd>
                <span className="chip wf-chip-draft">Draft</span> {saved ? `Revision ${saved.revision}, saved ${relative(saved.savedAt!)}` : "Not saved yet"} · from template v{work.baseVersion} ·{" "}
                {work.steps.length} steps
                {dirty && <b className="wf-unsaved"> · Unsaved changes</b>}
                {saved && saved.baseVersion !== template.version && <span className="muted"> · the template is now v{template.version}</span>}
              </dd>
            </div>
          </dl>
        </div>

        <div className="wf-goal-side">
          <div className="wf-banner sim">Design mode. A draft stays on this device. It doesn't change the template, Run mode or any live run, and nothing here starts work or calls a workflow.</div>
          <div className={`wf-design-status ${preview.ready ? "ready" : "not-ready"}`} role="status">
            <Icon name={preview.ready ? "check" : "alert"} size={15} />
            {preview.ready ? "Ready to preview" : `Not ready · ${preview.problems.length} thing${preview.problems.length === 1 ? "" : "s"} to fix`}
          </div>
          <div className="wf-design-actions">
            <button className="btn small" onClick={save} disabled={!dirty && !!saved}>
              <Icon name="download" size={13} /> Save draft
            </button>
            <button className="btn small primary wf-preview-btn" onClick={runPreview}>
              <Icon name="play" size={13} /> Preview
            </button>
            {(saved || dirty) &&
              (confirmReset ? (
                <span className="wf-confirm">
                  <span className="small">Drop the draft and start from the template?</span>
                  <button className="btn small" onClick={startOver}>
                    Drop draft
                  </button>
                  <button className="text-btn small" onClick={() => setConfirmReset(false)}>
                    Keep
                  </button>
                </span>
              ) : (
                <button className="text-btn small" onClick={() => setConfirmReset(true)}>
                  Start over from template
                </button>
              ))}
          </div>
          {msg && <p className="muted small wf-design-msg">{msg}</p>}
          {seed.notes.length > 0 && (
            <details className="wf-design-notes">
              <summary className="small">How the template became a draft</summary>
              <ul className="small muted">
                {seed.notes.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
            </details>
          )}
        </div>
      </section>

      <div className="wf-main">
        <section className="card wf-canvas-card wf-design-canvas" aria-label="Execution canvas">
          <div className="card-head wf-design-head">
            <h2 className="grow">Execution canvas</h2>
            <span className="chip wf-chip-draft">Draft</span>
            <button className="btn small" onClick={() => add("agent")}>
              + Agent step
            </button>
            <button className="btn small wf-add-approval" onClick={() => add("approval")}>
              + Approval
            </button>
          </div>
          <WorkflowCanvas
            layout={graph}
            resolved={resolved}
            status={status}
            selectedNode={step?.id ?? null}
            selectedBuilding={null}
            onPick={(id) => setSel(sel?.kind === "step" && sel.id === id ? null : { kind: "step", id })}
            notes={notes}
            selectedEdge={sel?.kind === "handoff" ? sel.id : null}
            onPickEdge={(id) => setSel(sel?.kind === "handoff" && sel.id === id ? null : { kind: "handoff", id })}
          />
          <p className="muted small wf-pad">New steps go after the selected step. Pick an arrow to see the handoff into the next step.</p>
        </section>

        <aside className="card wf-inspector wf-design-insp" aria-label="Step settings">
          {step ? (
            <StepEditor
              key={step.id}
              draft={work}
              step={step}
              catalog={catalog}
              problems={preview.problems.filter((p) => p.stepId === step.id)}
              onChange={edit}
              onSelect={(id) => setSel(id ? { kind: "step", id } : null)}
            />
          ) : handoffTo ? (
            <HandoffEditor
              draft={work}
              to={handoffTo}
              problems={preview.problems.filter((p) => p.stepId === handoffTo.id && /^Receives|produce/.test(p.text))}
              onChange={edit}
              onEditStep={() => setSel({ kind: "step", id: handoffTo.id })}
            />
          ) : (
            <div className="wf-empty">
              <Icon name="flow" size={22} />
              <p>Select a step to edit its agent, instructions, inputs, output and failure behaviour, or an arrow to see a handoff.</p>
            </div>
          )}
        </aside>
      </div>

      <section className="card wf-design-list" aria-label="Steps in order">
        <div className="card-head">
          <h2 className="grow">Steps in order</h2>
          <span className="muted small">{work.steps.length} steps</span>
        </div>
        <ol className="wf-design-steps">
          {work.steps.map((s, i) => {
            const issues = preview.problems.filter((p) => p.stepId === s.id).length;
            const r = resolved.get(s.id);
            return (
              <li key={s.id} className={`kind-${s.kind}${step?.id === s.id ? " on" : ""}`}>
                <button className="wf-design-step" onClick={() => setSel({ kind: "step", id: s.id })} aria-pressed={step?.id === s.id}>
                  <span className="wf-design-num">{i + 1}</span>
                  <span className="wf-design-step-main">
                    <b>{s.title || "Untitled step"}</b>
                    <span className="muted small">
                      {KIND_LABEL[s.kind]}
                      {s.kind === "agent" && ` · ${r?.agentName ?? "No agent"}`}
                      {s.kind === "agent" && s.outputs.some((o) => o.trim()) && ` · produces ${s.outputs.filter((o) => o.trim()).join(", ")}`}
                      {s.handoffs.length > 0 && ` · receives ${s.handoffs.length} handoff${s.handoffs.length === 1 ? "" : "s"}`}
                    </span>
                  </span>
                  {issues > 0 && <span className="wf-tone tone-bad">{issues} to fix</span>}
                </button>
              </li>
            );
          })}
        </ol>
      </section>

      {showPreview && (
        <section ref={previewRef} className="card wf-preview" aria-label="Preview">
          <div className="card-head">
            <h2 className="grow">Preview</h2>
            <span className="chip wf-chip-sim">Preview only · nothing runs</span>
          </div>
          <div className="wf-pad">
            {preview.ready ? (
              <p className="wf-preview-ok">Ready. This is what would happen, in order, if this draft ran. Nothing has run: no agent, workflow or service was contacted.</p>
            ) : (
              <div className="task-callout warn">
                <b>Not ready to preview as a working workflow</b>
                <span>Fix these first. The steps below show the draft as it stands.</span>
                <ul>
                  {preview.problems.map((p, i) => (
                    <li key={i}>
                      {p.stepId ? (
                        <button className="text-btn small" onClick={() => setSel({ kind: "step", id: p.stepId! })}>
                          {work.steps.find((s) => s.id === p.stepId)?.title || p.stepId}
                        </button>
                      ) : null}{" "}
                      {p.text}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <ol className="wf-preview-lines">
              {preview.lines.map((l) => (
                <li key={l.stepId}>
                  <b>{l.title}</b> <span>{l.text.replace(/^\d+\.\s/, "")}</span>
                </li>
              ))}
            </ol>
            <p className="muted small">Starting a live run still uses the saved template from Run mode. Running a draft comes in a later change.</p>
          </div>
        </section>
      )}
    </>
  );
}

const lines = (xs: readonly string[]) => xs.join("\n");
const unlines = (s: string) => s.split("\n");

function Problems({ problems }: { problems: DraftProblem[] }) {
  if (!problems.length) return null;
  return (
    <div className="task-callout warn">
      <b>To fix</b>
      <ul>
        {problems.map((p, i) => (
          <li key={i}>{p.text}</li>
        ))}
      </ul>
    </div>
  );
}

interface StepEditorProps {
  draft: WorkflowDraft;
  step: DesignStep;
  catalog: Catalog;
  problems: DraftProblem[];
  onChange: (d: WorkflowDraft) => void;
  onSelect: (id: string | null) => void;
}

function StepEditor({ draft, step, catalog, problems, onChange, onSelect }: StepEditorProps) {
  const i = draft.steps.findIndex((s) => s.id === step.id);
  const set = (patch: Partial<DesignStep>) => onChange(updateStep(draft, step.id, patch));
  const agents = useMemo(
    () =>
      catalog.agents
        .filter((a) => a.status !== "retired")
        .map((a) => ({ id: a.id, label: a.registry?.title ?? a.name, building: catalog.projects.find((p) => p.id === a.projectId)?.name }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [catalog],
  );
  const isEnd = step.kind === "outcome";
  const fixed = isEnd || (i > 0 && draft.steps[i + 1]?.kind === "outcome");
  return (
    <div className="wf-insp wf-step-edit">
      <div className="wf-insp-head">
        <span className={`chip${step.kind === "approval" ? " wf-chip-gold" : ""}`}>
          {i + 1} · {KIND_LABEL[step.kind]}
        </span>
        <span className="muted small">id {step.id}</span>
      </div>
      <Problems problems={problems} />

      <label className="wf-field">
        <span className="muted">Step name</span>
        <input value={step.title} onChange={(e) => set({ title: e.target.value })} />
      </label>

      {step.kind === "agent" && (
        <label className="wf-field">
          <span className="muted">Agent</span>
          <select
            value={step.agentId ?? ""}
            onChange={(e) => set(e.target.value ? { agentId: e.target.value, unconfigured: undefined, execution: { kind: "owned", note: "Done by the assigned agent." } } : { agentId: undefined })}
          >
            <option value="">Choose an Atlas agent</option>
            {step.agentId && !agents.some((a) => a.id === step.agentId) && <option value={step.agentId}>{step.agentId} (not available)</option>}
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.label}
                {a.building ? ` · ${a.building}` : ""}
              </option>
            ))}
          </select>
        </label>
      )}

      {step.kind === "approval" ? (
        <>
          <div className="wf-field">
            <span className="muted">Who approves</span>
            <span>Khaneil, in the Task Center. An agent or workflow can never approve.</span>
          </div>
          <label className="wf-field">
            <span className="muted">What Khaneil is approving</span>
            <textarea rows={3} value={step.approval?.reason ?? ""} onChange={(e) => set({ approval: { categories: step.approval?.categories ?? [], reason: e.target.value } })} />
          </label>
          <HandoffPicker draft={draft} to={step} onChange={onChange} legend="What Khaneil reviews" />
          <fieldset className="wf-cats">
            <legend className="muted small">Sensitive work it covers (optional)</legend>
            {SENSITIVE_CATEGORIES.map((c) => (
              <label key={c} className="wf-check">
                <input
                  type="checkbox"
                  checked={!!step.approval?.categories.includes(c)}
                  onChange={(e) => {
                    const cats = step.approval?.categories ?? [];
                    set({ approval: { reason: step.approval?.reason ?? "", categories: e.target.checked ? [...cats, c] : cats.filter((x) => x !== c) } });
                  }}
                />
                {CATEGORY_LABEL[c]}
              </label>
            ))}
          </fieldset>
        </>
      ) : (
        <label className="wf-field">
          <span className="muted">{isEnd ? "What done looks like" : "Instructions"}</span>
          <textarea rows={3} value={step.instructions} onChange={(e) => set({ instructions: e.target.value })} />
        </label>
      )}

      {step.kind === "agent" && (
        <>
          <HandoffPicker draft={draft} to={step} onChange={onChange} />
          <label className="wf-field">
            <span className="muted">Other inputs (one per line)</span>
            <textarea rows={Math.max(2, step.inputs.length)} value={lines(step.inputs)} onChange={(e) => set({ inputs: unlines(e.target.value) })} />
          </label>
          <label className="wf-field">
            <span className="muted">Expected output (one per line)</span>
            <textarea rows={Math.max(2, step.outputs.length)} value={lines(step.outputs)} onChange={(e) => set({ outputs: unlines(e.target.value) })} />
          </label>
          <label className="wf-field">
            <span className="muted">If it fails</span>
            <select value={step.onFailure} onChange={(e) => set({ onFailure: e.target.value as DesignStep["onFailure"] })}>
              {FAILURE_BEHAVIORS.map((f) => (
                <option key={f} value={f}>
                  {FAILURE_LABEL[f]}
                </option>
              ))}
            </select>
          </label>
          {step.approval && step.approval.categories.length > 0 && (
            <p className="muted small">
              Khaneil approves this step before it runs ({step.approval.categories.map((c) => CATEGORY_LABEL[c]).join(", ")}
              ), as the template says.
            </p>
          )}
        </>
      )}

      {!isEnd && (
        <div className="wf-step-tools">
          <button className="btn small" onClick={() => onChange(moveStep(draft, step.id, -1))} disabled={i === 0}>
            ↑ Move earlier
          </button>
          <button className="btn small" onClick={() => onChange(moveStep(draft, step.id, 1))} disabled={fixed}>
            ↓ Move later
          </button>
          <button
            className="btn small wf-remove"
            onClick={() => {
              onChange(removeStep(draft, step.id));
              onSelect(null);
            }}
          >
            Remove step
          </button>
        </div>
      )}
    </div>
  );
}

/** The earlier outputs a step can take as inputs, as checkboxes, plus any handoff that's broken. */
function HandoffPicker({ draft, to, onChange, legend = "Input from earlier steps" }: { draft: WorkflowDraft; to: DesignStep; onChange: (d: WorkflowDraft) => void; legend?: string }) {
  const options = availableOutputs(draft, to.id);
  const title = (id: string) => draft.steps.find((s) => s.id === id)?.title ?? "a removed step";
  const has = (fromStepId: string, output: string) => to.handoffs.some((h) => h.fromStepId === fromStepId && h.output === output);
  const broken = to.handoffs.filter((h) => !options.some((o) => o.fromStepId === h.fromStepId && o.output === h.output));
  return (
    <fieldset className="wf-handoffs">
      <legend className="muted small">{legend}</legend>
      {options.length === 0 && <p className="muted small">No earlier step produces anything yet.</p>}
      {options.map((o) => (
        <label key={`${o.fromStepId}:${o.output}`} className="wf-check">
          <input type="checkbox" checked={has(o.fromStepId, o.output)} onChange={() => onChange(toggleHandoff(draft, to.id, o))} />
          <span>
            {o.output} <span className="muted small">from {title(o.fromStepId)}</span>
          </span>
        </label>
      ))}
      {broken.map((h) => (
        <div key={`${h.fromStepId}:${h.output}`} className="wf-broken">
          <span className="small">
            {h.output} <span className="muted">from {title(h.fromStepId)} · no longer available</span>
          </span>
          <button className="text-btn small" onClick={() => onChange(toggleHandoff(draft, to.id, h))}>
            Remove
          </button>
        </div>
      ))}
    </fieldset>
  );
}

function HandoffEditor({
  draft,
  to,
  problems,
  onChange,
  onEditStep,
}: {
  draft: WorkflowDraft;
  to: DesignStep;
  problems: DraftProblem[];
  onChange: (d: WorkflowDraft) => void;
  onEditStep: () => void;
}) {
  const i = draft.steps.findIndex((s) => s.id === to.id);
  const from = draft.steps[i - 1];
  return (
    <div className="wf-insp wf-step-edit">
      <div className="wf-insp-head">
        <span className="chip wf-chip-gold">Handoff</span>
      </div>
      <h3>
        {from?.title} → {to.title}
      </h3>
      <p className="muted">
        {to.kind === "approval"
          ? "Khaneil reviews the work so far here before anything after it starts."
          : to.kind === "outcome"
            ? "The workflow completes once the step before finishes."
            : `What ${to.title} receives when it starts. Any earlier step's output can be passed on, not only the one just before.`}
      </p>
      <Problems problems={problems} />
      {to.kind !== "outcome" && <HandoffPicker draft={draft} to={to} onChange={onChange} legend={to.kind === "approval" ? "What Khaneil reviews" : "Input from earlier steps"} />}
      <button className="btn small" onClick={onEditStep}>
        Edit {to.title}
      </button>
    </div>
  );
}
