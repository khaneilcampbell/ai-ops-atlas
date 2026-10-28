import { useState, type ReactNode } from "react";
import { PHONE_QUERY, useMedia } from "../../lib/media";
import { setEditMode, useEditMode } from "../../edit/mode";
import { Icon } from "../Icon";
import { CatalogEditor, type CatalogTarget } from "./CatalogEditor";
import { FileEditor } from "./FileEditor";

/** The header's Edit switch. Off on every launch; while off, no edit buttons appear anywhere. */
export function EditToggle() {
  const on = useEditMode();
  return (
    <button
      className={`edit-toggle ${on ? "on" : ""}`}
      aria-pressed={on}
      onClick={() => setEditMode(!on)}
      title={on ? "Editing is on: Edit buttons show in the inspectors. Every save is reviewed and opens a pull request." : "Turn on editing to change catalog details and repository files from the app"}
    >
      <Icon name="edit" size={14} />
      <span>{on ? "Editing" : "Edit"}</span>
    </button>
  );
}

/** "Edit details" for an agent or project, shown only while the Edit switch is on. */
export function EditDetailsButton({ target, label = "Edit details" }: { target: CatalogTarget | null; label?: string }) {
  const on = useEditMode();
  const [open, setOpen] = useState(false);
  if (!on || !target) return null;
  return (
    <>
      <button className="ghost-btn dark small-edit" onClick={() => setOpen(true)}>
        <Icon name="edit" size={13} /> {label}
      </button>
      {open && <CatalogEditor target={target} onClose={() => setOpen(false)} />}
    </>
  );
}

/** "Edit files" for a repository, shown only while the Edit switch is on. */
export function EditFilesButton({ repo }: { repo: string }) {
  const on = useEditMode();
  const [open, setOpen] = useState(false);
  if (!on) return null;
  return (
    <>
      <button className="ghost-btn dark small-edit" onClick={() => setOpen(true)}>
        <Icon name="commit" size={13} /> Edit files
      </button>
      {open && <FileEditor repo={repo} onClose={() => setOpen(false)} />}
    </>
  );
}

/**
 * The edit buttons under an inspector's title. On a phone the inspector covers the header,
 * so while editing is off it offers the same switch here instead.
 */
export function InspectorEditRow({ children }: { children: ReactNode }) {
  const on = useEditMode();
  const phone = useMedia(PHONE_QUERY);
  if (!on && !phone) return null;
  return (
    <div className="edit-row">
      {on ? (
        children
      ) : (
        <button className="text-btn small" onClick={() => setEditMode(true)}>
          <Icon name="edit" size={12} /> Turn on editing
        </button>
      )}
    </div>
  );
}
