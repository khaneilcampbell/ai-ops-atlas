import { useState } from "react";
import { Icon } from "../../components/Icon";
import { checkStartInput, type StartableWorkflow, type StartInput } from "../../n8n/startable";

/**
 * The input form for one startable n8n workflow, drawn from its schema, then a review step that
 * says exactly what will be sent and what the workflow never does. Nothing is sent until Confirm.
 */
export function N8nStartForm({ workflow, desktop, busy, onStart, onCancel }: { workflow: StartableWorkflow; desktop: boolean; busy: boolean; onStart: (input: StartInput) => void; onCancel: () => void }) {
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(workflow.fields.map((f) => [f.name, f.default ?? ""])));
  const [review, setReview] = useState<StartInput | null>(null);
  const [error, setError] = useState<string | null>(null);
  const set = (name: string, v: string) => {
    setValues((x) => ({ ...x, [name]: v }));
    setReview(null);
  };

  const check = () => {
    const r = checkStartInput(workflow, values);
    if (r.ok) {
      setError(null);
      setReview(r.input);
    } else setError(r.error);
  };

  return (
    <div className="task-callout good n8n-start" aria-label={`Start ${workflow.name}`}>
      <b>Start {workflow.name} in n8n</b>
      <span>{workflow.does}</span>
      {review ? (
        <>
          <dl className="n8n-start-review">
            {workflow.fields
              .filter((f) => review[f.name] !== "" && review[f.name] !== undefined)
              .map((f) => (
                <div key={f.name}>
                  <dt>{f.label}</dt>
                  <dd>{f.kind === "choice" ? (f.options?.find((o) => o.value === review[f.name])?.label ?? String(review[f.name])) : String(review[f.name]).length > 280 ? `${String(review[f.name]).slice(0, 280)}… (${String(review[f.name]).length} characters)` : String(review[f.name])}</dd>
                </div>
              ))}
          </dl>
          <span>{workflow.never}</span>
          <div className="task-actions">
            <button className="btn primary" disabled={busy} onClick={() => onStart(review)}>
              <Icon name="play" size={13} /> {busy ? (desktop ? "Waiting for Touch ID…" : "Starting…") : desktop ? "Confirm with Touch ID and start" : "Confirm and start"}
            </button>
            <button className="btn" disabled={busy} onClick={() => setReview(null)}>
              Edit
            </button>
            <button className="btn" disabled={busy} onClick={onCancel}>
              Cancel
            </button>
          </div>
        </>
      ) : (
        <form
          className="task-form n8n-start-form"
          onSubmit={(e) => {
            e.preventDefault();
            check();
          }}
        >
          {workflow.fields.map((f) => (
            <label key={f.name} className="task-field">
              <span>
                {f.label}
                {f.required ? " *" : ""}
              </span>
              {f.kind === "textarea" ? (
                <textarea value={values[f.name]} onChange={(e) => set(f.name, e.target.value)} rows={4} maxLength={f.max} placeholder={f.placeholder} />
              ) : f.kind === "choice" ? (
                <select value={values[f.name]} onChange={(e) => set(f.name, e.target.value)}>
                  {f.options?.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  type={f.kind === "number" ? "number" : f.kind === "url" ? "url" : "text"}
                  inputMode={f.kind === "number" ? "decimal" : undefined}
                  min={f.kind === "number" ? f.min : undefined}
                  max={f.kind === "number" ? f.maxValue : undefined}
                  maxLength={f.kind === "number" ? undefined : f.max}
                  value={values[f.name]}
                  onChange={(e) => set(f.name, e.target.value)}
                  placeholder={f.placeholder}
                />
              )}
              {f.hint && <small className="muted">{f.hint}</small>}
            </label>
          ))}
          {error && <p className="task-error small">{error}</p>}
          <div className="task-actions">
            <button className="btn primary" type="submit">
              Review
            </button>
            <button className="btn" type="button" onClick={onCancel}>
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
