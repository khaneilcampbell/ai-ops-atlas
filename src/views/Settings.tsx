import { useEffect, useState } from "react";
import { Icon } from "../components/Icon";
import { tokenStore } from "../lib/token";
import { useAtlas } from "../state";

export function SettingsView() {
  const { settings, setSettings, clearCache, catalog, manifestIssues, refresh } = useAtlas();
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
      </section>

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
          Running in a browser preview. Public repositories load without a token; open the desktop app to add a Keychain-stored token for private repositories and higher rate limits.
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
