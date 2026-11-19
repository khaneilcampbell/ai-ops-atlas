import { useRef, useState } from "react";
import { backupFileName, createBackup, parseBackup, planRestore, restoreBackup, undoAvailable, undoRestore, type Backup, type RestorePlan } from "../lib/backup";
import { isTauri } from "../lib/env";
import { formatDateTime } from "../lib/timezone";

// Backup and restore for the records kept only on this device. Saving writes a JSON file the person
// keeps; restoring shows what would change and asks once before replacing anything, and the
// previous records stay one click away under Undo.

async function saveFile(name: string, json: string): Promise<boolean> {
  if (isTauri()) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<boolean>("save_backup", { name, text: json });
  }
  const url = URL.createObjectURL(new Blob([json], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
  return true;
}

type Pending = { backup: Backup; plan: RestorePlan };

export function BackupSetting() {
  const [note, setNote] = useState<{ tone: "good" | "bad"; text: string } | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [undo, setUndo] = useState(() => !!safeUndo());
  const input = useRef<HTMLInputElement>(null);

  const save = async () => {
    const b = createBackup(localStorage, isTauri() ? "mac" : "web");
    if (!b.ok) return setNote({ tone: "bad", text: b.error });
    try {
      const saved = await saveFile(backupFileName(), b.json);
      if (saved) setNote({ tone: "good", text: `Saved ${b.keys.length} records.` });
    } catch (e) {
      setNote({ tone: "bad", text: e instanceof Error ? e.message : String(e) });
    }
  };

  const pick = async (f: File | undefined) => {
    if (!f) return;
    const p = parseBackup(await f.text());
    if (input.current) input.current.value = "";
    if (!p.ok) return setNote({ tone: "bad", text: p.error });
    setNote(null);
    setPending({ backup: p.backup, plan: planRestore(localStorage, p.backup) });
  };

  const confirm = () => {
    if (!pending) return;
    const r = restoreBackup(localStorage, pending.backup);
    setPending(null);
    if (!r.ok) return setNote({ tone: "bad", text: r.error });
    // Every store reads its records at start, so reload to pick up the restored ones.
    window.location.reload();
  };

  const runUndo = () => {
    const r = undoRestore(localStorage);
    if (!r.ok) return setNote({ tone: "bad", text: r.error });
    setUndo(false);
    window.location.reload();
  };

  return (
    <>
      <div className="setting">
        <div className="grow">
          <div className="label">Back up this device's records</div>
          <div className="muted small">Tasks, workflow runs, agent memory, business records and settings live only here. Save a copy now and then; GitHub caches are left out and credentials are never included.</div>
        </div>
        <button className="btn" onClick={() => void save()}>
          Save backup
        </button>
      </div>
      <div className="setting">
        <div className="grow">
          <div className="label">Restore from a backup</div>
          <div className="muted small">Shows what would change first. The records you have now are kept so the restore can be undone.</div>
        </div>
        <input ref={input} type="file" accept="application/json,.json" style={{ display: "none" }} onChange={(e) => void pick(e.target.files?.[0])} />
        <button className="btn" onClick={() => input.current?.click()}>
          Choose file
        </button>
        {undo && (
          <button className="btn" onClick={runUndo}>
            Undo last restore
          </button>
        )}
      </div>
      {pending && (
        <div className="setting" role="alertdialog" aria-label="Confirm restore">
          <div className="grow">
            <div className="label">Restore the backup from {formatDateTime(pending.backup.createdAt)}?</div>
            <div className="muted small">
              {pending.plan.write.length} records replaced or added, {pending.plan.remove.length} removed, {pending.plan.unchanged.length} unchanged.
              {pending.plan.remove.length ? ` Removed: ${pending.plan.remove.join(", ")}.` : ""}
            </div>
          </div>
          <button className="btn" onClick={() => setPending(null)}>
            Cancel
          </button>
          <button className="btn primary" onClick={confirm} disabled={!pending.plan.write.length && !pending.plan.remove.length}>
            Restore
          </button>
        </div>
      )}
      {note && (
        <div className={`muted small backup-note ${note.tone}`} role="status" style={{ padding: "0 16px 12px" }}>
          {note.text}
        </div>
      )}
    </>
  );
}

function safeUndo() {
  try {
    return undoAvailable(localStorage);
  } catch {
    return null;
  }
}
