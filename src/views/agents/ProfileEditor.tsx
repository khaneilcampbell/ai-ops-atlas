import { useState } from "react";
import type { Agent } from "../../catalog/types";
import { editableFields, repositoryText, saveProfileEdit, useProfileEdits } from "../../catalog/profileEdits";
import { checkProfileText, cleanProfileText, PROFILE_FIELD_SPEC, type ProfileField } from "../../data/profileEdits";
import { formatDateTime } from "../../lib/timezone";
import "../../styles/profileEditor.css";

/** "Edited in Atlas" next to an agent whose shown text differs from its catalog file. */
export function EditedTag({ agentId }: { agentId: string }) {
  const s = useProfileEdits();
  if (s.state !== "ready" || !s.edited.has(agentId)) return null;
  return (
    <span className="chip profile-edited" title="Some of this profile's text was changed in Atlas. The repository file still has the original.">
      Edited in Atlas
    </span>
  );
}

const valueOf = (agent: Agent, f: ProfileField) => {
  const idn = agent.registry?.identity;
  return { display_name: idn?.displayName, title: agent.name, summary: agent.registry?.summary ?? agent.purpose, intro: idn?.intro, voice: idn?.voice }[f] ?? "";
};

/**
 * Edit an agent's display text without a pull request: name, job title, description, intro and
 * communication style. Saved in the Atlas database with a log, shown on every tab at once, and
 * undone per field with "Use repository text". Changes nothing about how the agent runs.
 */
export function ProfileEditor({ agent }: { agent: Agent }) {
  const s = useProfileEdits();
  const [open, setOpen] = useState(false);
  const fields = editableFields(agent);
  const [draft, setDraft] = useState<Partial<Record<ProfileField, string>>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  if (s.state === "off" || s.state === "loading") return null;
  if (s.state === "unavailable")
    return (
      <p className="muted small profile-edit-off" role="note">
        Editing is unavailable: {s.message}
      </p>
    );

  const edits = s.edits.filter((e) => e.entity_id === agent.id);
  const editOf = (f: ProfileField) => edits.find((e) => e.field === f);
  const textOf = (f: ProfileField) => draft[f] ?? valueOf(agent, f);
  const changed = fields.filter((f) => cleanProfileText(f, textOf(f)) !== valueOf(agent, f));
  const problems = changed.map((f) => checkProfileText(f, cleanProfileText(f, textOf(f)))).filter(Boolean) as string[];
  const history = s.log.filter((l) => l.entity_id === agent.id).slice(0, 5);

  const start = () => {
    setDraft({});
    setMessage(null);
    setOpen(true);
  };

  const save = async () => {
    setBusy(true);
    setMessage(null);
    for (const f of changed) {
      const r = await saveProfileEdit({ entityId: agent.id, field: f, value: cleanProfileText(f, textOf(f)), expectedVersion: editOf(f)?.version ?? 1 });
      if (!r.ok) {
        setBusy(false);
        setMessage({ ok: false, text: `${PROFILE_FIELD_SPEC[f].label}: ${r.message}` });
        return;
      }
    }
    setBusy(false);
    setDraft({});
    setOpen(false);
    setMessage({ ok: true, text: changed.length ? "Saved. Every tab shows the new text." : "Nothing changed." });
  };

  const restoreRepository = async (f: ProfileField) => {
    setBusy(true);
    const r = await saveProfileEdit({ entityId: agent.id, field: f, value: null, expectedVersion: editOf(f)?.version });
    setBusy(false);
    if (!r.ok) return setMessage({ ok: false, text: `${PROFILE_FIELD_SPEC[f].label}: ${r.message}` });
    setDraft((d) => ({ ...d, [f]: undefined }));
    setMessage({ ok: true, text: `${PROFILE_FIELD_SPEC[f].label} is back to the repository text.` });
  };

  if (!open)
    return (
      <div className="profile-edit-bar">
        <button type="button" className="btn ghost small" onClick={start}>
          Edit profile text
        </button>
        {message && (
          <span className={`small ${message.ok ? "muted" : "profile-edit-error"}`} role="status">
            {message.text}
          </span>
        )}
      </div>
    );

  return (
    <form
      className="profile-editor"
      aria-label={`Edit ${agent.name} profile text`}
      onSubmit={(e) => {
        e.preventDefault();
        if (!busy && !problems.length) void save();
      }}
    >
      <p className="muted small">Display text only. Status, schedule, tools and permissions still come from n8n and the repository. Saved changes are logged and show on every tab.</p>
      {fields.map((f) => {
        const spec = PROFILE_FIELD_SPEC[f];
        const edit = editOf(f);
        const repo = repositoryText(agent, f);
        const id = `pe-${agent.id}-${f}`;
        return (
          <div className="task-field profile-field" key={f}>
            <span>
              <label htmlFor={id}>{spec.label}</label>
              {edit && <em className="profile-field-edited">Edited {formatDateTime(edit.updated_at)}</em>}
            </span>
            {spec.multiline ? (
              <textarea id={id} rows={3} maxLength={spec.max} value={textOf(f)} onChange={(e) => setDraft((d) => ({ ...d, [f]: e.target.value }))} aria-describedby={`${id}-hint`} />
            ) : (
              <input id={id} maxLength={spec.max} value={textOf(f)} onChange={(e) => setDraft((d) => ({ ...d, [f]: e.target.value }))} aria-describedby={`${id}-hint`} />
            )}
            <small id={`${id}-hint`} className="muted">
              {spec.hint} {textOf(f).length}/{spec.max}
              {edit && repo !== null && (
                <>
                  {" · "}
                  <button type="button" className="linkish" disabled={busy} onClick={() => void restoreRepository(f)}>
                    Use repository text
                  </button>{" "}
                  <span className="profile-repo-text">({repo.length > 80 ? `${repo.slice(0, 80)}…` : repo})</span>
                </>
              )}
            </small>
          </div>
        );
      })}
      {problems.length > 0 && (
        <p className="small profile-edit-error" role="alert">
          {problems[0]}
        </p>
      )}
      {message && !message.ok && (
        <p className="small profile-edit-error" role="alert">
          {message.text}
        </p>
      )}
      <div className="profile-edit-actions">
        <button type="submit" className="btn primary" disabled={busy || !changed.length || problems.length > 0}>
          {busy ? "Saving…" : changed.length ? `Save ${changed.length === 1 ? "change" : `${changed.length} changes`}` : "Save"}
        </button>
        <button type="button" className="btn ghost" disabled={busy} onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
      {history.length > 0 && (
        <details className="profile-history">
          <summary className="small">Change log</summary>
          <ul className="small">
            {history.map((l, i) => (
              <li key={`${l.at}-${i}`}>
                {formatDateTime(l.at)} · {PROFILE_FIELD_SPEC[l.field].label}: {l.after === null ? "back to repository text" : `"${l.after}"`}
              </li>
            ))}
          </ul>
        </details>
      )}
    </form>
  );
}
