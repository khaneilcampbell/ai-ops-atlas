import { projectRepositories } from "../catalog/projects";
import { useMemo, useState } from "react";
import { actionsApi } from "../actions/api";
import { describeRecord, latestPerAttempt, STAGE_LABEL } from "../actions/rerun";
import { useActions } from "../actions/state";
import { MANIFEST } from "../manage/manifest";
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
    () => [...new Set(catalog.projects.flatMap((p) => projectRepositories(p, catalog.agents)).concat(catalog.agents.map((a) => a.repository), uncataloged))].sort((a, b) => a.localeCompare(b)),
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
          Atlas can do three kinds of things on GitHub: re-run the failed jobs of a failed workflow run, merge a pull request GitHub reports as ready, and enable, disable or run the agents in Manage agents. Each is off until you turn it on here, works only on
          the repositories or agents you allow, and every press asks for confirmation in a macOS dialog and is written to an audit log on this Mac. Your read-only token above is never used for any of them.
        </div>
      </div>

      <div className="setting">
        <div className="grow">
          <div className="label">Actions token</div>
          <div className="muted small">
            {hasToken
              ? `Saved in your macOS Keychain${status?.config.token_login ? ` for ${status.config.token_login}` : ""}. Removing it also turns re-runs off.`
              : "A separate fine-grained token: Only select repositories, with Actions: Read and write and nothing else. Classic ghp_ tokens aren't accepted."}
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

      <AgentsSettings />

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
              <span className={`result r-${r.stage === "started" || r.stage === "merged" || r.stage === "changed" || r.stage === "opened" ? "success" : r.stage === "failed" || r.stage === "unknown" ? "failure" : "other"}`}>{STAGE_LABEL[r.stage]}</span>
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
 * Manage agents: one fine-grained token for the allow-listed agents' repository. Saving it
 * turns on Enable, Disable and Run now in Agents → Manage agents; removing it turns them off.
 */
function AgentsSettings() {
  const { status, reload } = useActions();
  const { setView } = useAtlas();
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const has = !!status?.agents_token;

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

  return (
    <>
      <div className="setting">
        <div className="grow">
          <div className="label">Manage agents</div>
          <div className="muted small">
            {has
              ? `On. Token saved in your macOS Keychain${status?.config.agents_token_login ? ` for ${status.config.agents_token_login}` : ""}. Enable, Disable and Run now work in Agents → Manage agents, only for the agents on Atlas's allow-list. Removing the token turns them off.`
              : `Off. Save a separate fine-grained token to turn on Enable, Disable and Run now for the agents on Atlas's allow-list: Only select repositories (just ${MANIFEST.repository.split("/")[1]}), with Actions: Read and write and nothing else.`}
          </div>
        </div>
        {has ? (
          <button className="btn" disabled={busy} onClick={() => run(() => actionsApi.clearAgentsToken())}>
            Remove
          </button>
        ) : (
          <button className="btn" onClick={() => setView("agents")}>
            See agents
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
            placeholder={has ? "Replace the Manage agents token" : "github_pat_…"}
            style={{ width: "100%" }}
            aria-label="Manage agents token"
          />
        </label>
        <button
          className="btn primary"
          disabled={!value.trim() || busy}
          onClick={() =>
            run(async () => {
              await actionsApi.setAgentsToken(value.trim());
              setValue("");
            })
          }
        >
          Check and save
        </button>
      </div>
      {error && (
        <div className="setting">
          <div className="notice bad">{error}</div>
        </div>
      )}
    </>
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
      {sw.enabled && (
        <>
          <div className="setting">
            <div className="grow">
              <div className="label">Merge tokens</div>
              <div className="muted small">
                One fine-grained token per repository: Only select repositories (just that one), with Pull requests and Contents: Read and write and nothing else. Saved in your macOS Keychain.
              </div>
            </div>
          </div>
          <div className="setting">
            <select className="btn" value={repo} onChange={(e) => setRepo(e.target.value)} aria-label="Repository for the merge token" disabled={busy}>
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
                aria-label="Merge token"
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
                    disabled={busy}
                    onChange={(e) => void save(true, e.target.checked ? [...sw.repos, r] : sw.repos.filter((x) => x.toLowerCase() !== r.toLowerCase()))}
                  />
                  <span className="grow">
                    <span className="mono">{r}</span>
                    <div className="muted small">Token for {sw.token_logins[r.toLowerCase()] ?? "an unknown account"}{listed(r) ? " · merges allowed" : " · not ticked"}</div>
                  </span>
                  <button className="btn small" disabled={busy} onClick={() => run(() => actionsApi.clearMergeToken(r))}>
                    Remove token
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <div className="setting">
              <div className="muted small">No merge tokens saved yet.</div>
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
