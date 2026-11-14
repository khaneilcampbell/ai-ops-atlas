import { useEffect, useState } from "react";
import { Icon } from "../../components/Icon";
import { formatTime } from "../../lib/timezone";
import { cooldownLeft, REGISTRY_SHEET_URL, requestRegistryRefresh, viewOf, type RefreshView } from "../../n8n/registryRefresh";

/** Refresh registry sheet: runs the n8n Agent Registry workflow now, then says how it went. */
export function RegistryRefresh() {
  const [view, setView] = useState<RefreshView>({ state: "idle" });
  const [lastPress, setLastPress] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const wait = cooldownLeft(lastPress, now);

  // Tick only while a countdown is showing.
  useEffect(() => {
    if (view.state !== "running" && wait === 0) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [view.state, wait]);

  const run = async () => {
    const at = Date.now();
    setLastPress(at);
    setNow(at);
    setView({ state: "running", startedAt: at });
    setView(viewOf(await requestRegistryRefresh(), Date.now()));
  };

  const busy = view.state === "running";
  const label = busy ? "Refreshing…" : wait > 0 ? `Refresh again in ${wait} s` : "Refresh registry sheet";
  return (
    <div className="registry-refresh" aria-live="polite">
      <button className="btn small" onClick={run} disabled={busy || wait > 0} title="Runs the n8n Agent Registry workflow now, instead of waiting for its 4-hour schedule">
        <Icon name="refresh" size={12} /> {label}
      </button>
      <a className="text-btn small" href={REGISTRY_SHEET_URL} target="_blank" rel="noreferrer">
        <Icon name="external" size={12} /> Open sheet
      </a>
      {view.state === "running" && <span className="muted">Running in n8n… {Math.max(0, Math.round((now - view.startedAt) / 1000))} s</span>}
      {view.state === "done" && <span className="refresh-ok">Sheet updated at {formatTime(view.finishedAt, { hour: "numeric", minute: "2-digit" })}</span>}
      {view.state === "failed" && <span className="refresh-failed">Not refreshed: {view.message}</span>}
    </div>
  );
}
