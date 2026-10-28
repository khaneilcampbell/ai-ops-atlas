import { useEffect, useState } from "react";
import { catalogPath, CATALOG_REPO, readFile, type RepoFile } from "../../edit/api";
import { editManifest, fieldEdits, readFields, type EditableFields } from "../../edit/catalogYaml";
import { STATUSES, type Link } from "../../catalog/types";
import { statusLabel } from "../bits";
import { Icon } from "../Icon";
import { EditSheet, Review, useEditBlock } from "./EditSheet";

export type CatalogTarget = { kind: "project"; file: string; name: string } | { kind: "agent"; file: string; id: string; name: string };

type Loaded = { file: RepoFile; base: (string | number)[]; v2: boolean; fields: EditableFields };

/**
 * Edits an agent's or project's catalog details. The form starts from the manifest as it is on
 * GitHub now (not the copy bundled in this build), and saving shows the YAML diff before a pull
 * request is opened on the Atlas repository. The app picks the change up once it is merged.
 */
export function CatalogEditor({ target, onClose }: { target: CatalogTarget; onClose: () => void }) {
  const path = catalogPath(target.file);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<EditableFields | null>(null);
  const [review, setReview] = useState<{ after: string } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const block = useEditBlock(CATALOG_REPO);

  const agentId = target.kind === "agent" ? target.id : null;
  useEffect(() => {
    let live = true;
    readFile(CATALOG_REPO, path)
      .then((file) => {
        const r = readFields(file.text, agentId === null ? { kind: "project" } : { kind: "agent", id: agentId });
        if (!r) throw new Error(agentId !== null ? `The agent ${agentId} isn't in ${path} on GitHub any more.` : `${path} has no project block.`);
        if (!live) return;
        setLoaded({ file, ...r });
        setForm(r.fields);
      })
      .catch((e) => live && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      live = false;
    };
  }, [path, agentId]);

  const set = (patch: Partial<EditableFields>) => setForm((f) => (f ? { ...f, ...patch } : f));
  const setLink = (i: number, patch: Partial<Link>) => set({ links: form!.links.map((l, j) => (j === i ? { ...l, ...patch } : l)) });

  const toReview = () => {
    if (!loaded || !form) return;
    setProblem(null);
    try {
      const edits = fieldEdits(loaded.base, target.kind, loaded.fields, form, loaded.v2);
      if (edits.length === 0) return setProblem("Nothing changed yet.");
      const out = editManifest(target.file, loaded.file.text, edits);
      if (out.issues.length) return setProblem(`The catalog check would reject this: ${out.issues.map((i) => i.message).join("; ")}.`);
      setReview({ after: out.text });
    } catch (e) {
      setProblem(e instanceof Error ? e.message : String(e));
    }
  };

  const what = target.kind === "agent" ? "Agent" : "Project";
  return (
    <EditSheet eyebrow={`Edit ${what.toLowerCase()} details · ${path}`} title={target.name} onClose={onClose}>
      {error && (
        <div className="notice bad">
          <Icon name="alert" size={15} /> {error}
        </div>
      )}
      {!error && !form && <div className="muted small">Loading the manifest from GitHub…</div>}
      {loaded && form && review && (
        <Review
          repo={CATALOG_REPO}
          path={path}
          before={loaded.file.text}
          after={review.after}
          baseSha={loaded.file.sha}
          defaultTitle={`Catalog: update ${target.name}`}
          onBack={() => setReview(null)}
          onDone={() => {}}
        />
      )}
      {loaded && form && !review && (
        <form
          className="edit-form"
          onSubmit={(e) => {
            e.preventDefault();
            toReview();
          }}
        >
          <div className="muted small">
            Loaded from the manifest on GitHub. Saving opens a pull request on <span className="mono">{CATALOG_REPO}</span>; Atlas shows the change after it is merged and the app updates.
          </div>
          <label className="edit-field">
            <span className="label">Name</span>
            <input value={form.name} onChange={(e) => set({ name: e.target.value })} required />
          </label>
          {target.kind === "agent" && loaded.v2 && (
            <label className="edit-field">
              <span className="label">Display title</span>
              <input value={form.title ?? ""} onChange={(e) => set({ title: e.target.value })} placeholder="Shown instead of the name when set" />
            </label>
          )}
          <label className="edit-field">
            <span className="label">{target.kind === "agent" ? "Purpose" : "Summary"}</span>
            <textarea rows={4} value={form.description} onChange={(e) => set({ description: e.target.value })} required />
          </label>
          <label className="edit-field">
            <span className="label">Status</span>
            <select value={form.status} onChange={(e) => set({ status: e.target.value as EditableFields["status"] })}>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {statusLabel(s)}
                </option>
              ))}
            </select>
          </label>
          {target.kind === "agent" && (
            <>
              <label className="edit-field">
                <span className="label">Trigger</span>
                <input value={form.trigger ?? ""} onChange={(e) => set({ trigger: e.target.value })} placeholder="What starts it, e.g. Weekly on Monday" />
              </label>
              {loaded.v2 && (
                <>
                  <label className="edit-field">
                    <span className="label">Schedule</span>
                    <input value={form.schedule ?? ""} onChange={(e) => set({ schedule: e.target.value })} placeholder="e.g. Daily at 06:00 UTC" />
                  </label>
                  <label className="edit-field">
                    <span className="label">Owner</span>
                    <input value={form.owner ?? ""} onChange={(e) => set({ owner: e.target.value })} placeholder="Who holds its keys" />
                  </label>
                </>
              )}
            </>
          )}
          <fieldset className="edit-links">
            <legend className="label">Links</legend>
            {form.links.map((l, i) => (
              <div key={i} className="edit-link">
                <input aria-label={`Link ${i + 1} label`} value={l.label} onChange={(e) => setLink(i, { label: e.target.value })} placeholder="Label" />
                <input aria-label={`Link ${i + 1} address`} value={l.url} onChange={(e) => setLink(i, { url: e.target.value })} placeholder="https://" inputMode="url" />
                <button type="button" className="icon-btn" aria-label={`Remove link ${i + 1}`} onClick={() => set({ links: form.links.filter((_, j) => j !== i) })}>
                  <Icon name="close" size={14} />
                </button>
              </div>
            ))}
            <button type="button" className="text-btn small" onClick={() => set({ links: [...form.links, { label: "", url: "" }] })}>
              <Icon name="plus" size={12} /> Add link
            </button>
          </fieldset>
          {problem && <div className="notice bad">{problem}</div>}
          {block && <div className="notice">{block}</div>}
          <div className="edit-actions">
            <button type="button" className="btn" onClick={onClose}>
              Cancel
            </button>
            <span className="grow" />
            <button type="submit" className="btn primary">
              Review changes
            </button>
          </div>
        </form>
      )}
    </EditSheet>
  );
}
