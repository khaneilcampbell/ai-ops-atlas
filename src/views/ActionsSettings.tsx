import { useMemo, useState } from "react";
import { actionsApi } from "../actions/api";
import { latestPerAttempt, STAGE_LABEL } from "../actions/rerun";
import { useActions } from "../actions/state";
import { Icon } from "../components/Icon";
import { relative } from "../lib/time";
import { useAtlas } from "../state";

/**
 * Settings for the one approval-required action. Off by default; it needs its own
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
          Atlas can do one thing on GitHub: re-run the failed jobs of a failed workflow run. It's off until you turn it on here, works only on the repositories you tick, and every press asks for
          confirmation in a macOS dialog and is written to an audit log on this Mac. Your read-only token above is never used for it.
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
              <span className={`result r-${r.stage === "started" ? "success" : r.stage === "failed" || r.stage === "unknown" ? "failure" : "other"}`}>{STAGE_LABEL[r.stage]}</span>
              <span className="grow">
                {r.workflow ?? "Run"} {r.run_number ? `#${r.run_number}` : r.run_id} · <span className="mono">{r.repo}</span>
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
