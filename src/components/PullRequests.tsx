import { useCallback, useEffect, useState } from "react";
import { actionsApi } from "../actions/api";
import { mergeAvailability } from "../actions/merge";
import { opAvailability } from "../actions/ops";
import { useActions } from "../actions/state";
import type { AuditRecord, MergeCheck } from "../actions/types";
import { fetchOpenPulls, type PullSummary } from "../github/pulls";
import { relative } from "../lib/time";
import { useAtlas } from "../state";
import { ExternalLink } from "./bits";
import { Icon } from "./Icon";
import { OpButton } from "./OpButton";

/** Readiness checks per page load; each one is a handful of GitHub reads. */
const MAX_CHECKS = 10;

type Check = MergeCheck | "checking";

/**
 * A repository's open pull requests. In the desktop app, with merging switched on for the
 * repository, each one is checked with GitHub and a Merge button appears only on those GitHub
 * reports ready. Pressing it only asks: the app checks again, shows a native confirmation,
 * asks for Touch ID and logs the attempt before anything reaches GitHub. With pull request
 * changes switched on, Close and Comment work the same way, and pull requests closed from
 * Atlas are listed with a Reopen button.
 */
export function PullRequests({ repo }: { repo: string }) {
  const { status, audit } = useActions();
  const { refresh } = useAtlas();
  const avail = mergeAvailability(repo, status);
  const changes = opAvailability("pull_request_changes", repo, status);
  const [commenting, setCommenting] = useState<number | null>(null);
  const [comment, setComment] = useState("");
  // Closed from Atlas and not reopened since, newest first: the only closed PRs offered for reopening.
  const closedHere = closedFromAtlas(audit, repo, changes.show);
  const canCheck = avail.show && avail.enabled;
  const [pulls, setPulls] = useState<PullSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checks, setChecks] = useState<Record<number, Check>>({});
  const [busy, setBusy] = useState<number | null>(null);
  const [notes, setNotes] = useState<Record<number, { ok: boolean; text: string } | null>>({});

  const check = useCallback(
    async (list: PullSummary[]) => {
      if (!canCheck) return;
      for (const p of list.filter((p) => !p.draft).slice(0, MAX_CHECKS)) {
        setChecks((c) => ({ ...c, [p.number]: "checking" }));
        try {
          const r = await actionsApi.mergeCheck(repo, p.number);
          setChecks((c) => ({ ...c, [p.number]: r }));
        } catch (e) {
          setChecks((c) => ({ ...c, [p.number]: { ready: false, reason: "error", message: String(e), preview: null } }));
        }
      }
    },
    [repo, canCheck],
  );

  const load = useCallback(async () => {
    setError(null);
    setChecks({});
    try {
      const list = await fetchOpenPulls(repo);
      setPulls(list);
      void check(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [repo, check]);

  useEffect(() => {
    void load();
  }, [load]);

  const merge = async (p: PullSummary, c: MergeCheck) => {
    if (!c.preview) return;
    setBusy(p.number);
    setNotes((n) => ({ ...n, [p.number]: null }));
    try {
      const o = await actionsApi.mergePr(repo, p.number, c.preview.head_sha);
      // A cancelled dialog needs no message; everything else says what happened.
      if (o.stage !== "cancelled" || o.reason === "touch_id") setNotes((n) => ({ ...n, [p.number]: { ok: o.stage === "merged", text: o.message } }));
      if (o.stage === "merged" || o.stage === "unknown") {
        void refresh(true);
        void load();
      } else if (o.stage === "refused") {
        // Something changed since the check: show the current state instead of a stale button.
        setChecks((cs) => ({ ...cs, [p.number]: { ready: false, reason: o.reason, message: o.message, preview: null } }));
      }
    } catch (e) {
      setNotes((n) => ({ ...n, [p.number]: { ok: false, text: String(e) } }));
    } finally {
      setBusy(null);
    }
  };

  return (
    <section>
      <div className="section-head">
        <div className="section-title">Open pull requests{pulls ? ` (${pulls.length}${pulls.length === 20 ? "+" : ""})` : ""}</div>
        <button className="text-btn small" onClick={() => void load()} title="Reload from GitHub">
          <Icon name="refresh" size={12} /> Refresh
        </button>
      </div>
      {avail.show && !avail.enabled && <div className="muted small">Merging: {avail.reason}.</div>}
      {changes.show && !changes.enabled && <div className="muted small">Close and comment: {changes.reason}.</div>}
      {error ? (
        <div className="notice">
          <Icon name="alert" size={15} /> {error}
        </div>
      ) : pulls === null ? (
        <div className="muted small">Loading…</div>
      ) : pulls.length === 0 ? (
        <div className="muted small">No open pull requests.</div>
      ) : (
        <ul className="runs pulls">
          {pulls.map((p) => {
            const c = checks[p.number];
            const note = notes[p.number];
            return (
              <li key={p.number}>
                <i className={`h-${p.draft ? "unknown" : c && c !== "checking" ? (c.ready ? "good" : "warn") : "unknown"}`} />
                <span className="grow">
                  <ExternalLink href={p.url}>
                    #{p.number} {p.title}
                  </ExternalLink>
                  <div className="muted small">
                    <span className="mono">{p.head}</span> into <span className="mono">{p.base}</span>
                    {p.author ? ` · ${p.author}` : ""} · {relative(p.updatedAt)}
                    {p.draft && " · Draft"}
                  </div>
                  {c === "checking" && <div className="muted small">Checking with GitHub…</div>}
                  {c && c !== "checking" && !c.ready && <div className="muted small">{c.message}</div>}
                  {note && (
                    <div className={`rerun-note small ${note.ok ? "ok" : "bad"}`} role="status">
                      {note.text}
                    </div>
                  )}
                  {commenting === p.number && (
                    <div className="pull-comment">
                      <textarea className="input" rows={3} maxLength={4000} value={comment} placeholder="Comment, posted as you" aria-label={`Comment on #${p.number}`} onChange={(e) => setComment(e.target.value)} />
                      <OpButton
                        repo={repo}
                        group="pull_request_changes"
                        op={{ kind: "comment_pull", number: p.number, body: comment }}
                        label="Post"
                        icon="check"
                        disabled={!comment.trim()}
                        onDone={() => {
                          setComment("");
                          setCommenting(null);
                        }}
                      />
                    </div>
                  )}
                </span>
                <span className="pull-actions">
                  {c && c !== "checking" && c.ready && c.preview?.head_sha === p.headSha && (
                    <button className="btn small" disabled={busy !== null} title="Asks for confirmation and Touch ID before anything is sent to GitHub" onClick={() => void merge(p, c)}>
                      <Icon name="check" size={12} /> {busy === p.number ? "Waiting…" : "Merge"}
                    </button>
                  )}
                  {changes.show && changes.enabled && (
                    <button className="btn small" onClick={() => setCommenting(commenting === p.number ? null : p.number)} aria-expanded={commenting === p.number}>
                      <Icon name="plus" size={12} /> Comment
                    </button>
                  )}
                  <OpButton repo={repo} group="pull_request_changes" op={{ kind: "close_pull", number: p.number }} label="Close" icon="close" onDone={() => void load()} />
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {closedHere.length > 0 && (
        <>
          <div className="section-title" style={{ marginTop: 12 }}>
            Closed from Atlas
          </div>
          <ul className="runs pulls">
            {closedHere.map(([n, title]) => (
              <li key={n}>
                <i className="h-unknown" />
                <span className="grow">
                  <ExternalLink href={`https://github.com/${repo}/pull/${n}`}>
                    #{n} {title}
                  </ExternalLink>
                </span>
                <OpButton repo={repo} group="pull_request_changes" op={{ kind: "reopen_pull", number: n }} label="Reopen" icon="refresh" onDone={() => void load()} />
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

/** Pull requests whose latest close or reopen from Atlas was a close, newest first (at most 5). */
function closedFromAtlas(audit: AuditRecord[], repo: string, show: boolean): [number, string][] {
  if (!show) return [];
  const latest = new Map<number, AuditRecord>();
  // `audit` is newest first, so the first close or reopen per pull request is its latest.
  for (const r of audit) {
    if (r.stage !== "done" || r.pull_number == null || r.repo.toLowerCase() !== repo.toLowerCase()) continue;
    if (r.action !== "close_pull_request" && r.action !== "reopen_pull_request") continue;
    if (!latest.has(r.pull_number)) latest.set(r.pull_number, r);
  }
  return [...latest.values()]
    .filter((r) => r.action === "close_pull_request")
    .slice(0, 5)
    .map((r) => [r.pull_number!, r.title ?? ""]);
}
