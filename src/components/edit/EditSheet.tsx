import { useEffect, useMemo, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { canEdit, proposeEdit, useEditAccess, type EditOutcome } from "../../edit/api";
import { diff } from "../../edit/diff";
import { isTauri } from "../../lib/env";
import { ExternalLink } from "../bits";
import { Icon } from "../Icon";

/** A sheet over the app: centered on desktop, full screen on a phone. Escape or the scrim closes it. */
export function EditSheet({ title, eyebrow, onClose, children, footer }: { title: string; eyebrow: string; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);
  // On the body, so a transformed inspector can't trap the fixed layer.
  return createPortal(
    <div className="edit-layer">
      <div className="edit-scrim" onClick={onClose} />
      <section className="edit-sheet" role="dialog" aria-modal="true" aria-label={title}>
        <header className="edit-head">
          <div className="grow">
            <div className="eyebrow">{eyebrow}</div>
            <h2>{title}</h2>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close editor" style={{ color: "var(--ink-2)" }}>
            <Icon name="close" />
          </button>
        </header>
        <div className="edit-body selectable">{children}</div>
        {footer && <footer className="edit-foot">{footer}</footer>}
      </section>
    </div>,
    document.body,
  );
}

/** Every changed line with three lines of context, old and new line numbers side by side. */
export function DiffView({ before, after, path }: { before: string; after: string; path: string }) {
  const d = useMemo(() => diff(before, after), [before, after]);
  return (
    <div className="diff" aria-label={`Changes to ${path}`}>
      <div className="diff-head">
        <span className="mono grow">{path}</span>
        <span className="diff-add">+{d.added}</span>
        <span className="diff-del">−{d.removed}</span>
      </div>
      {d.hunks.length === 0 && <div className="muted small diff-empty">No changes.</div>}
      {d.hunks.map((h, i) => (
        <div key={i} className="diff-hunk">
          {h.lines.map((l, j) => (
            <div key={j} className={`diff-line ${l.kind}`}>
              <span className="ln">{l.oldNo ?? ""}</span>
              <span className="ln">{l.newNo ?? ""}</span>
              <span className="mark">{l.kind === "add" ? "+" : l.kind === "del" ? "−" : " "}</span>
              <code>{l.text || " "}</code>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

/** Why this repository can't take edits right now, with where to fix it. Null when it can. */
export function useEditBlock(repo: string): string | null {
  const access = useEditAccess();
  if (!access) return "Checking whether editing is on…";
  if (canEdit(access, repo)) return null;
  if (access.reason) return access.reason;
  return access.via === "web"
    ? `${repo} isn't in the site's EDIT_REPOS list, so the website can't edit it.`
    : `${repo} isn't ticked for edits. Tick it in Settings → Actions → Edit files (it needs a merge token).`;
}

/**
 * The review step: the exact diff, a title for the pull request, and one button that sends it.
 * In the Mac app a native dialog asks once more before anything reaches GitHub.
 */
export function Review({
  repo,
  path,
  before,
  after,
  baseSha,
  defaultTitle,
  onBack,
  onDone,
}: {
  repo: string;
  path: string;
  before: string;
  after: string;
  baseSha: string;
  defaultTitle: string;
  onBack: () => void;
  onDone: (o: EditOutcome) => void;
}) {
  const [title, setTitle] = useState(defaultTitle);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<EditOutcome | null>(null);
  const block = useEditBlock(repo);

  const send = async () => {
    setBusy(true);
    setOutcome(null);
    try {
      const o = await proposeEdit({ repo, path, base_sha: baseSha, content: after, title, note });
      // A cancelled dialog needs no message.
      if (o.stage !== "cancelled") setOutcome(o);
      if (o.stage === "opened") onDone(o);
    } catch (e) {
      setOutcome({ stage: "failed", reason: "error", message: String(e), pull_number: null, pull_url: null, branch: null });
    } finally {
      setBusy(false);
    }
  };

  if (outcome?.stage === "opened")
    return (
      <div className="edit-done" role="status">
        <Icon name="check" size={20} />
        <div className="grow">
          <div className="label">{outcome.message}</div>
          <div className="muted small">
            Branch <span className="mono">{outcome.branch}</span>. Merge it from this repository&apos;s PRs tab once its checks pass, or on GitHub.
          </div>
          {outcome.pull_url && (
            <ExternalLink href={outcome.pull_url} className="btn small">
              <Icon name="external" size={12} /> Open pull request #{outcome.pull_number}
            </ExternalLink>
          )}
        </div>
      </div>
    );

  return (
    <div className="edit-review">
      <div className="notice">
        <Icon name="commit" size={15} />
        <span>
          This is exactly what will change in <span className="mono">{repo}</span>. Atlas creates a new <span className="mono">atlas-edit/</span> branch, commits this one file there and opens a
          pull request. Nothing is pushed to the default branch and nothing is merged.
        </span>
      </div>
      <DiffView before={before} after={after} path={path} />
      <label className="edit-field">
        <span className="label">Pull request title</span>
        <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} />
      </label>
      <label className="edit-field">
        <span className="label">Note for the pull request (optional)</span>
        <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} placeholder="Why this change" />
      </label>
      {block && <div className="notice">{block}</div>}
      {outcome && <div className="notice bad" role="status">{outcome.message}</div>}
      <div className="edit-actions">
        <button className="btn" onClick={onBack} disabled={busy}>
          Back to editing
        </button>
        <span className="grow" />
        <button className="btn primary" disabled={busy || !!block || before === after} onClick={() => void send()} title={isTauri() ? "Asks for confirmation in a macOS dialog before anything is sent" : undefined}>
          <Icon name="commit" size={13} /> {busy ? "Opening…" : "Open pull request"}
        </button>
      </div>
    </div>
  );
}
