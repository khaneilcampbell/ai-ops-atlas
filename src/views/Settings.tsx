import { useEffect, useState } from "react";
import { Icon } from "../components/Icon";
import { relative } from "../lib/time";
import { tokenStore } from "../lib/token";
import { isHostedWeb } from "../lib/env";
import { useAtlas } from "../state";
import { ActionsSettings } from "./ActionsSettings";
import { IntelSettings } from "./IntelSettings";

export function SettingsView() {
  const { settings, setSettings, clearCache, catalog, manifestIssues, refresh, usage } = useAtlas();
  return (
    <div className="page" style={{ maxWidth: 860 }}>
      <div className="page-head">
        <div className="grow">
          <div className="eyebrow">Local preferences</div>
          <h1>Settings</h1>
        </div>
      </div>

      <section className="card" style={{ marginBottom: 16 }}>
        <div className="card-head">
          <h2 className="grow">GitHub access</h2>
          <span className="chip">
            <Icon name="lock" size={12} /> Read-only
          </span>
        </div>
        <TokenSetting onChange={() => void refresh(true)} />
        <UsageSetting usage={usage} />
      </section>

      <IntelSettings />

      <ActionsSettings />

      <section className="card" style={{ marginBottom: 16 }}>
        <div className="card-head">
          <h2 className="grow">Data</h2>
        </div>
        <div className="setting">
          <div className="grow">
            <div className="label">Refresh GitHub data every</div>
            <div className="muted small">Cached repository data is reused until it is older than this.</div>
          </div>
          <label className="field">
            <select value={settings.refreshMinutes} onChange={(e) => setSettings({ refreshMinutes: Number(e.target.value) })}>
              {[5, 15, 30, 60, 240].map((m) => (
                <option key={m} value={m}>
                  {m < 60 ? `${m} minutes` : `${m / 60} hour${m > 60 ? "s" : ""}`}
                </option>
              ))}
            </select>
          </label>
        </div>
        <OwnersSetting owners={settings.owners} onChange={(owners) => setSettings({ owners })} />
        <div className="setting">
          <div className="grow">
            <div className="label">Include forks</div>
            <div className="muted small">Show repositories you forked from others alongside your own.</div>
          </div>
          <input type="checkbox" className="toggle" checked={settings.includeForks} onChange={(e) => setSettings({ includeForks: e.target.checked })} />
        </div>
        <div className="setting">
          <div className="grow">
            <div className="label">Refresh when the app opens</div>
            <div className="muted small">Off means the app shows cached data until you press Refresh.</div>
          </div>
          <input type="checkbox" className="toggle" checked={settings.refreshOnLaunch} onChange={(e) => setSettings({ refreshOnLaunch: e.target.checked })} />
        </div>
        <div className="setting">
          <div className="grow">
            <div className="label">Always show agent labels on the map</div>
          </div>
          <input type="checkbox" className="toggle" checked={settings.showMapLabels} onChange={(e) => setSettings({ showMapLabels: e.target.checked })} />
        </div>
        <div className="setting">
          <div className="grow">
            <div className="label">Cached GitHub data</div>
            <div className="muted small">Stored on this Mac only. Clearing it fetches everything again.</div>
          </div>
          <button className="btn" onClick={clearCache}>
            Clear and refetch
          </button>
        </div>
      </section>

      <section className="card">
        <div className="card-head">
          <h2 className="grow">Catalog</h2>
          <span className="muted small">
            {catalog.projects.length} projects · {catalog.agents.length} agents
          </span>
        </div>
        <div className="setting" style={{ display: "block" }}>
          <p className="muted small" style={{ marginTop: 0 }}>
            Projects and agents come from the YAML manifests in the <span className="mono">catalog/</span> folder of the app source. Add a file there to register a project, then rebuild. The format is documented in{" "}
            <span className="mono">catalog/README.md</span>.
          </p>
          {manifestIssues.length === 0 ? (
            <div className="health">
              <i className="h-good" /> All manifests are valid
            </div>
          ) : (
            <ul className="issues small">
              {manifestIssues.map((i) => (
                <li key={i.file + i.message}>
                  <b>{i.file}</b>: {i.message}
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}

function UsageSetting({ usage }: { usage: ReturnType<typeof useAtlas>["usage"] }) {
  const rate = usage?.rate;
  const resetsAt = rate && rate.reset * 1000 > Date.now() ? new Date(rate.reset * 1000).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }) : null;
  const n = (v: number) => v.toLocaleString();
  return (
    <div className="setting">
      <div className="grow">
        <div className="label">GitHub request budget</div>
        <div className="muted small">
          {!usage
            ? "Shown after the first refresh."
            : usage.paused
              ? `GitHub's hourly limit is used up, so the last refresh was skipped${resetsAt ? ` until ${resetsAt}` : ""}. Cached data is still shown.`
              : `Last refresh ${relative(usage.at)}: ${n(usage.requests)} request${usage.requests === 1 ? "" : "s"}, ${n(usage.counted)} counted against your limit.${usage.skipped ? ` ${n(usage.skipped)} recently checked repositor${usage.skipped === 1 ? "y was" : "ies were"} left alone.` : ""}`}{" "}
          Unchanged repositories reuse cached commits and languages, and the timer pauses while the window is hidden.
        </div>
      </div>
      {rate && (
        <span className="chip" title={resetsAt ? `Resets at ${resetsAt}` : undefined}>
          {n(rate.remaining)} / {n(rate.limit)} left
        </span>
      )}
    </div>
  );
}

function TokenSetting({ onChange }: { onChange: () => void }) {
  const [has, setHas] = useState<boolean | null>(null);
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    tokenStore.has().then(setHas, () => setHas(false));
  }, []);

  if (!tokenStore.available()) {
    return (
      <div className="setting">
        <div className="grow muted small">
          {isHostedWeb()
            ? has
              ? "This web version reads GitHub with a read-only token kept on the server. It never reaches this browser. Change it in the Cloudflare dashboard."
              : "This web version has no GitHub token yet, so only public repositories load. Add one as the GITHUB_TOKEN secret in Cloudflare."
            : "Running in a browser preview. Public repositories load without a token; open the desktop app to add a Keychain-stored token for private repositories and higher rate limits."}
        </div>
      </div>
    );
  }

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await tokenStore.set(value.trim());
      setValue("");
      setHas(true);
      onChange();
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
          <div className="label">Personal access token</div>
          <div className="muted small">
            {has ? "A token is saved in your macOS Keychain. It is never shown here or written to logs." : "Optional. Without one, public repositories load with GitHub's anonymous rate limit."} Use a
            fine-grained token with read-only <span className="mono">Contents</span>, <span className="mono">Metadata</span> and <span className="mono">Actions</span> access.
          </div>
        </div>
        {has && (
          <button
            className="btn"
            onClick={async () => {
              await tokenStore.clear();
              setHas(false);
              onChange();
            }}
          >
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
            placeholder={has ? "Replace the saved token" : "github_pat_…"}
            style={{ width: "100%" }}
            aria-label="GitHub token"
          />
        </label>
        <button className="btn primary" disabled={!value.trim() || busy} onClick={save}>
          Save to Keychain
        </button>
      </div>
      {error && (
        <div className="setting">
          <div className="notice">{error}</div>
        </div>
      )}
    </>
  );
}

function OwnersSetting({ owners, onChange }: { owners: string[]; onChange: (o: string[]) => void }) {
  const [value, setValue] = useState(owners.join(", "));
  const parsed = value
    .split(/[\s,]+/)
    .map((v) => v.trim())
    .filter((v) => /^[A-Za-z0-9-]{1,39}$/.test(v));
  const changed = parsed.join(",") !== owners.join(",");
  return (
    <div className="setting">
      <div className="grow">
        <div className="label">Show every repository owned by</div>
        <div className="muted small">
          GitHub accounts, separated by commas. Repositories without a manifest still appear, marked as not in the catalog. Private ones need a token.
        </div>
      </div>
      <label className="field">
        <input value={value} onChange={(e) => setValue(e.target.value)} style={{ width: 180 }} aria-label="GitHub accounts" spellCheck={false} />
      </label>
      <button className="btn" disabled={!changed} onClick={() => onChange(parsed)}>
        Save
      </button>
    </div>
  );
}
