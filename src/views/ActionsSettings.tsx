import { useMemo, useState } from "react";
import { actionsApi } from "../actions/api";
import { GROUPS, opSwitch } from "../actions/ops";
import { describeRecord, isSelfRepo, latestPerAttempt, STAGE_LABEL } from "../actions/rerun";
import type { Group } from "../actions/types";
import { useActions } from "../actions/state";
import { Icon } from "../components/Icon";
import { relative } from "../lib/time";
import { useAtlas } from "../state";

/**
 * Settings for the approval-required actions. Each is off by default and needs its own
 * write-scoped token, a switch, and a list of repositories it may touch.
 */
export function ActionsSettings() {
  const { available, status, audit, reload } = useActions();
  const { catalog, uncataloged, setView } = useAtlas();
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const allRepos = useMemo(
    () => [...new Set(catalog.projects.map((p) => p.repository).concat(catalog.agents.map((a) => a.repository), uncataloged))].sort((a, b) => a.localeCompare(b)),
    [catalog, uncataloged],
  );
  const recent = useMemo(() => latestPerAttempt(audit).slice(0, 5), [audit]);

  if (!available) return null;
  const sw = status?.config.rerun_failed_jobs ?? { enabled: false, repos: [] };
  const hasToken = !!status?.token;
  const listed = (r: string) => sw.repos.some((x) => x.toLowerCase() === r.toLowerCase());

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await reload();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };
  const save = (enabled: boolean, repos: string[]) => run(() => actionsApi.setSettings(enabled, repos));

  return (
    <section className="card" style={{ marginBottom: 16 }}>
      <div className="card-head">
        <h2 className="grow">Actions</h2>
        <span className="chip chip-gold">Level 2 · Approval required</span>
      </div>
      <div className="setting">
        <div className="grow muted small">
          Atlas can make these changes on GitHub: re-run failed jobs, merge a ready pull request, cancel a run, start a workflow by hand, pause or resume a workflow, and close, reopen or
          comment on a pull request. Each is off until you turn it on here and works only on the repositories you tick. Every press asks for confirmation in a macOS dialog (and Touch ID for
          everything except re-runs) and is written to an audit log on this Mac. Your read-only token above is never used for any of them. Atlas never re-runs or starts its own workflows,
          because that publishes a release.
        </div>
      </div>

      <div className="setting">
        <div className="grow">
          <div className="label">Actions token</div>
          <div className="muted small">
            {hasToken
              ? `Saved in your macOS Keychain${status?.config.token_login ? ` for ${status.config.token_login}` : ""}. Removing it also turns re-runs off.`
              : "A separate fine-grained token: Only select repositories, with Actions: Read and write and nothing else. Classic ghp_ tokens aren't accepted."}{" "}
            Re-runs, cancels, manual runs and pause/resume all use it, on the repositories you give it on GitHub.
          </div>
        </div>
        {hasToken && (
          <button className="btn" disabled={busy} onClick={() => run(() => actionsApi.clearToken())}>
            Remove
          </button>
        )}
      </div>
      <div className="setting">
        <label className="field grow" style={{ flex: 1 }}>
          <Icon name="key" size={14} />
          <input
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={hasToken ? "Replace the Actions token" : "github_pat_…"}
            style={{ width: "100%" }}
            aria-label="GitHub Actions token"
          />
        </label>
        <button
          className="btn primary"
          disabled={!value.trim() || busy}
          onClick={() =>
            run(async () => {
              await actionsApi.setToken(value.trim());
              setValue("");
            })
          }
        >
          Check and save
        </button>
      </div>

      <div className="setting">
        <div className="grow">
          <div className="label">Re-run failed jobs</div>
          <div className="muted small">
            {hasToken ? "Shows a Re-run button next to failed runs on the repositories ticked below." : "Save an Actions token first."}
          </div>
        </div>
        <input
          type="checkbox"
          className="toggle"
          aria-label="Allow re-running failed jobs"
          checked={sw.enabled}
          disabled={busy || (!hasToken && !sw.enabled)}
          onChange={(e) => void save(e.target.checked, sw.repos)}
        />
      </div>
      {sw.enabled && (
        <div className="repo-checks" role="group" aria-label="Repositories that allow re-runs">
          {allRepos.map((r) => (
            <label key={r}>
              <input
                type="checkbox"
                checked={listed(r)}
                disabled={busy}
                onChange={(e) => void save(true, e.target.checked ? [...sw.repos, r] : sw.repos.filter((x) => x.toLowerCase() !== r.toLowerCase()))}
              />
              <span className="mono" title={r}>{r.split("/")[1]}</span>
            </label>
          ))}
        </div>
      )}
      {error && (
        <div className="setting">
          <div className="notice bad">{error}</div>
        </div>
      )}

      <MergeSettings allRepos={allRepos} />

      <EverydaySettings allRepos={allRepos} />

      <div className="setting">
        <div className="grow">
          <div className="label">Audit log</div>
          <div className="muted small">Every press of the button, including cancelled and refused ones. Kept on this Mac and never trimmed.</div>
        </div>
        {audit.length > 0 && (
          <button className="btn" onClick={() => setView("activity")}>
            Open in Activity
          </button>
        )}
      </div>
      {recent.length > 0 && (
        <ul className="audit-list">
          {recent.map((r) => (
            <li key={r.id}>
              <span className={`result r-${r.stage === "started" || r.stage === "merged" || r.stage === "done" ? "success" : r.stage === "failed" || r.stage === "unknown" ? "failure" : "other"}`}>{STAGE_LABEL[r.stage]}</span>
              <span className="grow">
                {describeRecord(r).subject} · <span className="mono">{r.repo}</span>
                {r.message && <div className="muted small">{r.message}</div>}
              </span>
              <span className="muted small nowrap">{relative(r.at)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * Merging pull requests: a switch, and one fine-grained token per repository so a leaked
 * token can merge in one place only. A repository can be ticked only once its token is saved.
 */
function MergeSettings({ allRepos }: { allRepos: string[] }) {
  const { status, reload } = useActions();
  const [repo, setRepo] = useState("");
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sw = status?.config.merge_pull_requests ?? { enabled: false, repos: [], token_logins: {} };
  const tokens = status?.merge_tokens ?? [];
  // Closing, reopening and commenting use the same per-repository tokens as merging.
  const prChanges = !!status?.config.pull_request_changes?.enabled;
  const withToken = allRepos.filter((r) => tokens.includes(r.toLowerCase()));
  const listed = (r: string) => sw.repos.some((x) => x.toLowerCase() === r.toLowerCase());

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await reload();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };
  const save = (enabled: boolean, repos: string[]) => run(() => actionsApi.setMergeSettings(enabled, repos));

  return (
    <>
      <div className="setting">
        <div className="grow">
          <div className="label">Merge pull requests</div>
          <div className="muted small">
            Shows a Merge button in a repository's PRs tab, only on pull requests GitHub reports mergeable with every required check green and no changes requested. Drafts are never offered,
            nothing can override a check, and each merge asks for confirmation and Touch ID. Squash merges only.
          </div>
        </div>
        <input type="checkbox" className="toggle" aria-label="Allow merging pull requests" checked={sw.enabled} disabled={busy} onChange={(e) => void save(e.target.checked, sw.repos)} />
      </div>
      {(sw.enabled || prChanges) && (
        <>
          <div className="setting">
            <div className="grow">
              <div className="label">Pull request tokens</div>
              <div className="muted small">
                One fine-grained token per repository: Only select repositories (just that one), with Pull requests and Contents: Read and write and nothing else. Saved in your macOS Keychain.
                Merging, closing, reopening and commenting all use it.
              </div>
            </div>
          </div>
          <div className="setting">
            <select className="btn" value={repo} onChange={(e) => setRepo(e.target.value)} aria-label="Repository for the pull request token" disabled={busy}>
              <option value="">Repository…</option>
              {allRepos.map((r) => (
                <option key={r} value={r}>
                  {r.split("/")[1]}
                  {tokens.includes(r.toLowerCase()) ? " (token saved)" : ""}
                </option>
              ))}
            </select>
            <label className="field grow" style={{ flex: 1 }}>
              <Icon name="key" size={14} />
              <input
                type="password"
                autoComplete="off"
                spellCheck={false}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder="github_pat_…"
                style={{ width: "100%" }}
                aria-label="Pull request token"
              />
            </label>
            <button
              className="btn primary"
              disabled={!repo || !value.trim() || busy}
              onClick={() =>
                run(async () => {
                  await actionsApi.setMergeToken(repo, value.trim());
                  setValue("");
                })
              }
            >
              Check and save
            </button>
          </div>
          {withToken.length > 0 ? (
            <ul className="audit-list" aria-label="Repositories that allow merges">
              {withToken.map((r) => (
                <li key={r}>
                  <input
                    type="checkbox"
                    aria-label={`Allow merges in ${r}`}
                    checked={listed(r)}
                    disabled={busy || !sw.enabled}
                    onChange={(e) => void save(true, e.target.checked ? [...sw.repos, r] : sw.repos.filter((x) => x.toLowerCase() !== r.toLowerCase()))}
                  />
                  <span className="grow">
                    <span className="mono">{r}</span>
                    <div className="muted small">Token for {sw.token_logins[r.toLowerCase()] ?? "an unknown account"}{sw.enabled ? (listed(r) ? " · merges allowed" : " · merges not ticked") : ""}</div>
                  </span>
                  <button className="btn small" disabled={busy} onClick={() => run(() => actionsApi.clearMergeToken(r))}>
                    Remove token
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <div className="setting">
              <div className="muted small">No pull request tokens saved yet.</div>
            </div>
          )}
        </>
      )}
      {error && (
        <div className="setting">
          <div className="notice bad">{error}</div>
        </div>
      )}
    </>
  );
}

/**
 * The everyday actions: one switch per action and a tick per repository. Workflow actions use
 * the Actions token; pull request changes need the repository's pull request token.
 */
function EverydaySettings({ allRepos }: { allRepos: string[] }) {
  const { status, reload } = useActions();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hasToken = !!status?.token;
  const prTokens = status?.merge_tokens ?? [];

  const save = async (group: Group, enabled: boolean, repos: string[]) => {
    setBusy(true);
    setError(null);
    try {
      await actionsApi.setOpSettings(group, enabled, repos);
      await reload();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };
  const blocked = (group: Group, r: string): string | null => {
    if (group === "run_workflows" && isSelfRepo(r)) return "Atlas never starts its own workflows";
    if (group === "pull_request_changes" && !prTokens.includes(r.toLowerCase())) return "Save a pull request token for this repository first";
    return null;
  };

  return (
    <>
      <div className="setting">
        <div className="grow">
          <div className="label">Everyday changes</div>
          <div className="muted small">
            Switch an action on at the top of its column, then tick the repositories it may touch. Each press asks for confirmation and Touch ID.{" "}
            {GROUPS.map((g) => `${g.label}: ${g.help}`).join(" ")}
          </div>
        </div>
      </div>
      <div className="setting" style={{ overflowX: "auto" }}>
        <table className="op-matrix">
          <thead>
            <tr>
              <th>Repository</th>
              {GROUPS.map((g) => {
                const sw = opSwitch(status, g.group);
                const needsActions = g.group !== "pull_request_changes";
                return (
                  <th key={g.group}>
                    <label title={g.help}>
                      {g.short}
                      <input
                        type="checkbox"
                        className="toggle"
                        aria-label={`Allow: ${g.label}`}
                        checked={sw.enabled}
                        disabled={busy || (needsActions && !hasToken && !sw.enabled)}
                        onChange={(e) => void save(g.group, e.target.checked, sw.repos)}
                      />
                    </label>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {allRepos.map((r) => (
              <tr key={r}>
                <td className="mono" title={r}>
                  {r.split("/")[1]}
                </td>
                {GROUPS.map((g) => {
                  const sw = opSwitch(status, g.group);
                  const on = sw.repos.some((x) => x.toLowerCase() === r.toLowerCase());
                  const why = blocked(g.group, r);
                  return (
                    <td key={g.group}>
                      <input
                        type="checkbox"
                        aria-label={`${g.label} in ${r}`}
                        title={why ?? (sw.enabled ? g.label : "Switch this action on first")}
                        checked={on}
                        disabled={busy || !sw.enabled || (!!why && !on)}
                        onChange={(e) => void save(g.group, true, e.target.checked ? [...sw.repos, r] : sw.repos.filter((x) => x.toLowerCase() !== r.toLowerCase()))}
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!hasToken && (
        <div className="setting">
          <div className="muted small">Cancel, Run and Pause need the Actions token above.</div>
        </div>
      )}
      {error && (
        <div className="setting">
          <div className="notice bad">{error}</div>
        </div>
      )}
    </>
  );
}
