import { useEffect, useState } from "react";
import { Icon } from "../components/Icon";
import { copyText } from "../lib/clipboard";
import { useIntel } from "../intel/state";
import { relative } from "../lib/time";
import { syncConfigured, usageSync, type SyncStatus } from "../usage/sync";

const DEFAULT_SITE = "https://ai-ops-atlas.pages.dev";

/** Website sync: sends the Mac's recorded API usage to the hosted site. Off until set up. */
export function SyncSettings() {
  const intel = useIntel();
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [url, setUrl] = useState("");
  const [key, setKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!usageSync.available()) return;
    usageSync.status().then(
      (s) => {
        setStatus(s);
        setUrl(s.url ?? DEFAULT_SITE);
      },
      (e) => setError(String(e)),
    );
  }, []);

  if (!usageSync.available()) {
    return (
      <section className="card" style={{ marginBottom: 16 }}>
        <div className="card-head">
          <h2 className="grow">Website sync</h2>
        </div>
        <div className="setting">
          <div className="grow muted small">Set this up in the Mac app. It sends the Mac's recorded API usage to this site so the API Usage tab can show it here.</div>
        </div>
      </section>
    );
  }

  const run = async (f: () => Promise<SyncStatus | void>) => {
    setBusy(true);
    setError(null);
    try {
      const s = await f();
      if (s) setStatus(s);
    } catch (e) {
      setError(String(e));
      usageSync.status().then(setStatus, () => {});
    } finally {
      setBusy(false);
    }
  };

  const on = syncConfigured(status);
  return (
    <section className="card" style={{ marginBottom: 16 }}>
      <div className="card-head">
        <h2 className="grow">Website sync</h2>
        <span className="chip">{on ? "On" : "Off"}</span>
      </div>
      <div className="setting">
        <div className="grow muted small">
          Sends the API usage this Mac records (time, model, repository, tokens, estimated cost) to your Atlas website after each run and when you press Refresh on API Usage. No API key is ever sent. The sync key below only lets this
          Mac replace the usage shown there.
        </div>
      </div>

      <div className="setting">
        <div className="grow">
          <div className="label">Website address</div>
          <div className="muted small">{status?.url ? `Saved: ${status.url}` : "Not set."}</div>
        </div>
        <label className="field">
          <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder={DEFAULT_SITE} spellCheck={false} aria-label="Website address" />
        </label>
        <button className="btn" disabled={busy || !url.trim() || url.trim() === status?.url} onClick={() => void run(() => usageSync.setUrl(url))}>
          Save
        </button>
      </div>

      <div className="setting">
        <div className="grow">
          <div className="label">Sync key</div>
          <div className="muted small">
            {status?.key_present ? "A key is saved in your macOS Keychain. Making a new one means updating USAGE_SYNC_TOKEN in Cloudflare too." : "Make a key, then paste it into Cloudflare as the USAGE_SYNC_TOKEN secret."}
          </div>
        </div>
        <button
          className="btn"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              setKey(await usageSync.newKey());
              setCopied(false);
              return usageSync.status();
            })
          }
        >
          <Icon name="key" size={13} /> {status?.key_present ? "Make a new key" : "Make sync key"}
        </button>
      </div>
      {key && (
        <div className="setting">
          <div className="grow">
            <div className="notice">Copy this now and paste it into Cloudflare as USAGE_SYNC_TOKEN. It won't be shown again.</div>
            <div className="mono selectable sync-key">{key}</div>
          </div>
          <button
            className="btn"
            onClick={() =>
              void copyText(key).then(
                () => setCopied(true),
                () => setError("Couldn't copy. Select the key and copy it instead."),
              )
            }
          >
            {copied ? "Copied" : "Copy"}
          </button>
          <button className="btn" onClick={() => setKey(null)}>
            Done
          </button>
        </div>
      )}

      <div className="setting">
        <div className="grow">
          <div className="label">Last sync</div>
          <div className="muted small">
            {status?.last_error ? <span className="usage-bad">{status.last_error}</span> : status?.last_push_at ? `Sent ${relative(status.last_push_at)}.` : on ? "Nothing sent yet." : "Off until the address and key are both set."}
          </div>
        </div>
        <button className="btn primary" disabled={!on || busy} onClick={() => void run(() => usageSync.push(intel.status?.name ?? "Repository Intelligence"))}>
          Send now
        </button>
        {(status?.url || status?.key_present) && (
          <button className="btn" disabled={busy} onClick={() => void run(() => usageSync.clear())}>
            Turn off
          </button>
        )}
      </div>
      {error && (
        <div className="setting">
          <div className="notice">{error}</div>
        </div>
      )}
    </section>
  );
}
