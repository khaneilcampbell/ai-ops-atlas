import { useState } from "react";
import { actionsApi } from "../../actions/api";
import type { Agent } from "../../catalog/types";
import { Icon } from "../../components/Icon";
import { AUTONOMY_INFO, AUTONOMY_LEVELS } from "../../registry/types";

/**
 * Edit how this Mac shows an agent: name, owner, note and autonomy label. Saving asks in a
 * native dialog and is written to the audit log; nothing reaches a manifest or GitHub.
 * Desktop app only. Blank fields fall back to the manifest.
 */
export function CatalogEditor({ agent }: { agent: Agent }) {
  const e = agent.localEdit ?? {};
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(e.name ?? "");
  const [owner, setOwner] = useState(e.owner ?? "");
  const [note, setNote] = useState(e.note ?? "");
  const [autonomy, setAutonomy] = useState<string>(e.autonomy != null ? String(e.autonomy) : "");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  if (!actionsApi.available()) return null;

  const start = () => {
    setName(e.name ?? "");
    setOwner(e.owner ?? "");
    setNote(e.note ?? "");
    setAutonomy(e.autonomy != null ? String(e.autonomy) : "");
    setMsg(null);
    setOpen(true);
  };
  const save = async (edit: { name: string; owner: string; note: string; autonomy: string }) => {
    setBusy(true);
    setMsg(null);
    try {
      const saved = await actionsApi.setCatalogOverride(agent.id, {
        name: edit.name || null,
        owner: edit.owner || null,
        note: edit.note || null,
        autonomy: edit.autonomy === "" ? null : Number(edit.autonomy),
      });
      if (saved) {
        setOpen(false);
        setMsg({ ok: true, text: "Saved on this Mac." });
      }
    } catch (err) {
      setMsg({ ok: false, text: String(err) });
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <span className="rerun">
        <button className="btn small" onClick={start} title="Change how Atlas shows this agent on this Mac">
          <Icon name="tag" size={12} /> Edit details
        </button>
        {msg && <span className={`rerun-note small ${msg.ok ? "ok" : "bad"}`}>{msg.text}</span>}
      </span>
    );
  }
  const hasEdit = Object.values(e).some((v) => v != null && v !== "");
  return (
    <form
      className="catalog-editor"
      onSubmit={(ev) => {
        ev.preventDefault();
        void save({ name: name.trim(), owner: owner.trim(), note: note.trim(), autonomy });
      }}
    >
      <div className="muted small">Changes how Atlas shows this agent on this Mac only. Leave a field blank to use the manifest.</div>
      <label>
        <span className="label">Name</span>
        <input className="input" value={name} maxLength={80} placeholder={agent.registry?.title ?? agent.originalName ?? agent.name} onChange={(x) => setName(x.target.value)} />
      </label>
      <label>
        <span className="label">Owner</span>
        <input className="input" value={owner} maxLength={80} placeholder="Who looks after it" onChange={(x) => setOwner(x.target.value)} />
      </label>
      <label>
        <span className="label">Autonomy</span>
        <select className="btn" value={autonomy} onChange={(x) => setAutonomy(x.target.value)}>
          <option value="">From the manifest</option>
          {AUTONOMY_LEVELS.map((l) => (
            <option key={l} value={l}>
              {l} · {AUTONOMY_INFO[l].label}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span className="label">Note</span>
        <textarea className="input" rows={3} value={note} maxLength={2000} onChange={(x) => setNote(x.target.value)} />
      </label>
      {msg && <div className={`rerun-note small ${msg.ok ? "ok" : "bad"}`}>{msg.text}</div>}
      <div className="workflow-buttons">
        <button className="btn small primary" type="submit" disabled={busy}>
          {busy ? "Waiting…" : "Save"}
        </button>
        <button className="btn small" type="button" disabled={busy} onClick={() => setOpen(false)}>
          Cancel
        </button>
        {hasEdit && (
          <button className="btn small" type="button" disabled={busy} onClick={() => void save({ name: "", owner: "", note: "", autonomy: "" })} title="Go back to the manifest's values">
            Reset to manifest
          </button>
        )}
      </div>
    </form>
  );
}
