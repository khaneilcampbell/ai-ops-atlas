import { useState, useSyncExternalStore } from "react";
import { ExternalLink } from "../components/bits";
import { HOSTED_WEB_REASON, stewardStore } from "../steward/store";
import { isHostedWeb, isTauri } from "../lib/env";
import { STEWARD_REPO } from "../steward/check";
import { nextCheck } from "../steward/schedule";
import { formatDate, relative } from "../lib/time";

export function GithubSteward() {
  const state = useSyncExternalStore(stewardStore.subscribe, stewardStore.snapshot);
  const [picked, setPicked] = useState<string>();
  const [error, setError] = useState<string>();
  const selected = state.history.find((r) => r.id === picked) ?? state.history[0];
  const last = state.history.find((r) => r.status === "completed");
  const observed = state.lastObservedAt ?? state.history.find((r) => r.status === "completed" || r.status === "partial")?.finishedAt;
  const desktopOnly = isHostedWeb();
  const desktop = isTauri();
  const check = async () => {
    setError(undefined);
    setPicked(undefined);
    try { await stewardStore.run(); } catch { setError("The check could not finish. Try again after checking the connection."); }
  };
  return <div className="review">
    <section className="card card-pad">
      <div className="eyebrow">GitHub Steward · observe mode</div>
      <h2>Keep Atlas in view</h2>
      <p className="small">Checks CI, dependency alerts, code scanning and the presence of setup documentation and dependency update configuration. Uses Atlas’s existing read-only GitHub connection. No model calls or new API spending.</p>
      <dl className="kv">
        <dt>Repository scope</dt><dd><ExternalLink href={`https://github.com/${STEWARD_REPO}`}>{STEWARD_REPO}</ExternalLink></dd>
        <dt>Execution</dt><dd>{state.running ? state.paused ? "Pausing after the current request…" : "Checking…" : state.paused ? "Paused" : state.schedule.enabled ? "Ready · daily monitoring enabled" : "Ready · manual checks only"}</dd>
        <dt>Last complete check</dt><dd>{last ? `${formatDate(last.finishedAt)} · ${relative(last.finishedAt)}` : "None yet"}</dd>
        <dt>Last observation</dt><dd>{observed ? `${formatDate(observed)} · ${relative(observed)}${state.stale ? " · stale" : ""}` : "None yet"}</dd>
        <dt>Spending</dt><dd>$0 in model calls · GitHub request limits apply</dd>
        <dt>Guardrails</dt><dd>{desktop ? "One check at a time on this Mac · fixed repository and endpoints enforced by the app · " : "One check at a time across same-device Atlas windows · "}at most 7 requests · no retries · no repository changes</dd>
        <dt>Next daily check</dt><dd>{state.paused ? "Paused · resume to permit scheduled checks" : nextCheck(state.schedule)}</dd>
      </dl>
      <div className="intel-actions" style={{ marginTop: 16 }}>
        <button className="btn primary" disabled={desktopOnly || state.paused || state.running} onClick={() => void check()}>{state.running ? "Checking…" : "Check now"}</button>
        <button className="btn" disabled={state.running && state.paused} onClick={() => stewardStore.pause(!state.paused)}>{state.paused ? "Resume checks" : "Pause checks"}</button>
      </div>
      <p className="muted small">Pause blocks subsequent requests; an in-flight request may take up to 20 seconds. Resume also permits the daily check if monitoring is enabled.</p>
      <div className="intel-actions">
        <label><input type="checkbox" checked={state.schedule.enabled} disabled={desktopOnly || !state.lockSupported || state.storageError} onChange={(e) => stewardStore.configure(e.target.checked, state.schedule.time)} /> Daily monitoring while Atlas is open</label>
        <label className="field">Device time <input aria-label="Daily check time" type="time" value={state.schedule.time} disabled={state.running} onChange={(e) => stewardStore.configure(state.schedule.enabled, e.target.value)} /></label>
      </div>
      <p className="muted small">Runs once per day at the selected device time, or once when Atlas opens later that day. {desktop ? "Checks continue while the window is hidden, but not while Atlas is quit or the Mac is asleep." : "No checks while the app is closed."} Unchanged results stay quiet; important changes appear inside Atlas. Other devices and the standalone collector have separate schedules.</p>
    </section>
    {desktopOnly && <div className="notice" role="status">{HOSTED_WEB_REASON}</div>}
    {!desktopOnly && state.waiting && <div className="notice" role="status">{state.waiting}</div>}
    {error && <div className="notice bad" role="alert">{error}</div>}
    {state.error && <div className="notice bad" role="alert">{state.error}</div>}
    {!state.lockSupported && <div className="notice bad">This environment does not support the shared run lock. Checks and daily monitoring are blocked.</div>}
    {state.storageError && <div className="notice bad" role="alert">{state.storageMessage ?? "History could not be saved on this device. This session’s results remain visible."}</div>}
    {state.storageNote && <div className="notice" role="status">{state.storageNote}</div>}
    {state.stale && <div className="notice bad" role="status">The last observation is more than a day old. Check that Atlas was open at the scheduled time, then run a check.</div>}
    <div className="notice">Missing access or telemetry is shown as “Not verified.” Reliability, agent permissions, tooling costs, documentation quality and required branch checks need further assessment. Security alerts are counted here; open GitHub for private details.</div>
    <div className="grid two">
      <section className="card">
        <div className="card-head"><h2>Verified observations</h2></div>
        {!selected ? <div className="empty small">Choose Check now to gather the first observations.</div> : <div className="card-pad">
          <p className="muted small">{formatDate(selected.finishedAt)} · {selected.status === "failed" || selected.status === "interrupted" ? "request count unavailable" : `${selected.requests} requests`}{selected.rateRemaining !== undefined && ` · ${selected.rateRemaining} GitHub requests left this hour`}{selected.errorClass && ` · error: ${selected.errorClass}`} · {selected.status} · {selected.trigger ?? "manual"}{selected.commit && <> · commit <span className="mono">{selected.commit.slice(0, 12)}</span></>}</p>
          {selected.changes && <p className="small">{selected.changes.length ? `Changed observations: ${selected.changes.join(", ")}.` : selected.status === "paused" || selected.status === "failed" || selected.status === "interrupted" ? "Comparison unavailable for this run." : "No new actionable changes from the prior observations."}</p>}
          {selected.status === "interrupted" && <p className="small">Atlas quit or stopped while this check was running. No automatic retry runs the same day.</p>}
          {selected.status === "failed" && <p className="small">The check failed unexpectedly. No automatic retry will run today. You can investigate and start a manual check.</p>}
          <p className="muted small">Live snapshots may change during a check. The recorded commit identifies the branch head observed; security and workflow results are not a commit-bound audit.</p>
          {selected.checks.map((c) => <div key={c.id} style={{ marginBottom: 18 }}>
            <div className="small"><b><ExternalLink href={c.url}>{c.label}</ExternalLink></b> · <span className={c.state === "attention" ? "status attention" : "muted"}>{c.state === "clear" ? "Observed" : c.state === "unknown" ? "Not verified" : "Needs review"}</span></div>
            <p className="small" style={{ margin: "4px 0" }}>{c.detail}</p>
          </div>)}
          {selected.status === "paused" && <p className="small">Stopped before all checks finished. Previous results are available in history.</p>}
        </div>}
      </section>
      <section className="card">
        <div className="card-head"><h2>Run history</h2></div>
        {!state.history.length ? <div className="empty small">No runs yet.</div> : <ul className="list">{state.history.map((r) => <li key={r.id}>
          <button className="list-row" aria-pressed={selected?.id === r.id} onClick={() => setPicked(r.id)}><span className="grow"><span className="title">{formatDate(r.finishedAt)} · {new Date(r.finishedAt).toLocaleTimeString()}</span><span className="meta">{r.trigger ?? "manual"} · {r.status} · {r.checks.filter((c) => c.state === "attention").length} need review · {r.checks.filter((c) => c.state === "unknown").length} not verified</span></span></button>
        </li>)}</ul>}
        <div className="card-pad muted small">{desktop ? "The latest 30 summaries are saved in Atlas’s data folder on this Mac, with a one-line-per-run audit log beside them. Quitting Atlas ends a running check, which is then recorded as interrupted." : "The latest 30 summaries are saved in this app’s local storage on this device. Closing the app ends a running check. History is not an immutable audit log."}</div>
      </section>
    </div>
  </div>;
}
