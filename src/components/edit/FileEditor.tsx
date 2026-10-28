import { useCallback, useEffect, useState } from "react";
import { editableName, listDir, readFile, type DirEntry, type RepoFile } from "../../edit/api";
import { pathRefusal } from "../../../server/editRules";
import { Icon } from "../Icon";
import { EditSheet, Review, useEditBlock } from "./EditSheet";

/**
 * A plain text editor for one file in a repository: README, docs, config. Pick a file from the
 * default branch, change it, review the diff, and open a pull request. No AI is involved.
 */
export function FileEditor({ repo, onClose, initialPath }: { repo: string; onClose: () => void; initialPath?: string }) {
  const [dir, setDir] = useState("");
  const [entries, setEntries] = useState<DirEntry[] | null>(null);
  const [file, setFile] = useState<RepoFile | null>(null);
  const [text, setText] = useState("");
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const block = useEditBlock(repo);

  useEffect(() => {
    if (file) return;
    let live = true;
    setEntries(null);
    setError(null);
    listDir(repo, dir)
      .then((e) => live && setEntries(e))
      .catch((e) => live && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      live = false;
    };
  }, [repo, dir, file]);

  const open = useCallback(
    async (path: string) => {
      const refused = pathRefusal(path);
      if (refused) return setError(refused);
      setLoading(true);
      setError(null);
      try {
        const f = await readFile(repo, path);
        setFile(f);
        setText(f.text);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    },
    [repo],
  );

  useEffect(() => {
    if (initialPath) void open(initialPath);
  }, [initialPath, open]);

  const close = () => {
    if (file && text !== file.text && !window.confirm("Discard your changes to this file?")) return;
    onClose();
  };

  const crumbs = dir ? dir.split("/") : [];
  const changed = !!file && text !== file.text;

  return (
    <EditSheet eyebrow={`Edit files · ${repo}`} title={file ? file.path : "Choose a file"} onClose={close}>
      {error && (
        <div className="notice bad">
          <Icon name="alert" size={15} /> {error}
        </div>
      )}

      {!file && (
        <>
          <form
            className="edit-path"
            onSubmit={(e) => {
              e.preventDefault();
              if (typed.trim()) void open(typed.trim().replace(/^\/+/, ""));
            }}
          >
            <input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Path, e.g. README.md or docs/setup.md" aria-label="File path" spellCheck={false} autoCapitalize="off" />
            <button className="btn" type="submit" disabled={!typed.trim() || loading}>
              Open
            </button>
          </form>
          <nav className="edit-crumbs" aria-label="Folder">
            <button className="text-btn small" onClick={() => setDir("")}>
              {repo.split("/")[1]}
            </button>
            {crumbs.map((c, i) => (
              <span key={i}>
                / <button className="text-btn small" onClick={() => setDir(crumbs.slice(0, i + 1).join("/"))}>{c}</button>
              </span>
            ))}
          </nav>
          {entries === null && !error && <div className="muted small">Loading…</div>}
          {entries && (
            <ul className="edit-files">
              {entries.map((e) => {
                const editable = e.type === "dir" || (editableName(e.path) && !pathRefusal(e.path));
                return (
                  <li key={e.path}>
                    <button
                      className="list-row"
                      disabled={!editable || loading}
                      title={editable ? undefined : "Atlas only edits text files, and never workflow files"}
                      onClick={() => (e.type === "dir" ? setDir(e.path) : void open(e.path))}
                    >
                      <Icon name={e.type === "dir" ? "repos" : "edit"} size={14} />
                      <span className="grow mono">
                        {e.name}
                        {e.type === "dir" ? "/" : ""}
                      </span>
                      {e.type === "file" && <span className="muted small">{e.size < 1024 ? `${e.size} B` : `${Math.round(e.size / 1024)} KB`}</span>}
                    </button>
                  </li>
                );
              })}
              {entries.length === 0 && <li className="muted small">This folder is empty.</li>}
            </ul>
          )}
        </>
      )}

      {file && reviewing && (
        <Review
          repo={repo}
          path={file.path}
          before={file.text}
          after={text}
          baseSha={file.sha}
          defaultTitle={`Edit ${file.path}`}
          onBack={() => setReviewing(false)}
          onDone={() => {}}
        />
      )}

      {file && !reviewing && (
        <div className="edit-form">
          <div className="muted small">
            The version on the default branch. Changes stay here until you review them and open a pull request.
          </div>
          <textarea
            className="edit-text mono"
            value={text}
            onChange={(e) => setText(e.target.value)}
            spellCheck={/\.(md|mdx|markdown|txt)$/i.test(file.path)}
            autoCapitalize="off"
            autoCorrect="off"
            aria-label={`Contents of ${file.path}`}
          />
          {block && <div className="notice">{block}</div>}
          <div className="edit-actions">
            <button
              className="btn"
              onClick={() => {
                if (changed && !window.confirm("Discard your changes to this file?")) return;
                setFile(null);
              }}
            >
              Other file
            </button>
            {changed && (
              <button className="btn" onClick={() => setText(file.text)}>
                Undo changes
              </button>
            )}
            <span className="grow" />
            <button className="btn primary" disabled={!changed} onClick={() => setReviewing(true)}>
              Review changes
            </button>
          </div>
        </div>
      )}
    </EditSheet>
  );
}
