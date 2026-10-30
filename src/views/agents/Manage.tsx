import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { actionsApi } from "../../actions/api";
import { useActions } from "../../actions/state";
import type { AgentOp, ConfigChange, ConfigOutcome, Outcome } from "../../actions/types";
import { ExternalLink } from "../../components/bits";
import { Icon } from "../../components/Icon";
import { formatDate, relative } from "../../lib/time";
import { fetchManageData, MANAGE_STATUS_LABEL, manageRows, type ManageData, type ManageRow, type ManageStatus } from "../../manage/data";
import { describeCron, parseCron } from "../../manage/cron";
import { capProblem, HARD_MAX_CAP_USD, MANIFEST, scheduleProblem } from "../../manage/manifest";
import { useAtlas } from "../../state";

// Kept for the session, so switching tabs and back shows the last answer at once. A new
// fetch happens only when the view opens again or on Refresh.
let lastData: ManageData | null = null;

const STATUS_CLASS: Record<ManageStatus, string> = { disabled: "paused", running: "active", failing: "attention", ok: "active", never: "idle", unknown: "retired" };

const usd = (n: number) => `$${n.toFixed(2)}`;
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
/** "Thu 13:41 UTC" within a week, otherwise the date. Schedules are UTC, so this is too. */
function nextLabel(iso: string, now = Date.now()) {
  const d = new Date(iso);
  const hm = `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")} UTC`;
  if (d.getTime() - now > 6 * 86_400_000) return `${formatDate(iso)} ${hm}`;
  const today = new Date(now).getUTCDate() === d.getUTCDate() && d.getTime() - now < 86_400_000;
  return `${today ? "today" : DAYS[d.getUTCDay()]} ${hm}`;
}
const runResult = (r: { status: string; conclusion: string | null }) => (r.status !== "completed" ? "Running" : r.conclusion === "success" ? "Succeeded" : r.conclusion ? r.conclusion.replace(/_/g, " ") : "Unknown");
const EVENT_LABEL: Record<string, string> = { schedule: "Schedule", workflow_dispatch: "Manual", push: "Push", workflow_run: "After CI", pull_request: "Pull request" };

/** Where controls can work: never on the web, and in the Mac app only once its token is saved. */
type Mode = "web" | "no-token" | "ready";

/** Manage agents: every agent Atlas can manage, from the allow-list in src/manage/agents.json. */
export function Manage({ open }: { open: (id: string) => void }) {
  const { catalog, setView, select } = useAtlas();
  const actions = useActions();
  const mode: Mode = !actions.available ? "web" : actions.status?.agents_token ? "ready" : "no-token";
  const [data, setData] = useState<ManageData | null>(lastData);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const busy = useRef(false);

  const refresh = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    setLoading(true);
    try {
      const d = await fetchManageData(MANIFEST);
      lastData = d;
      setData(d);
      setFailed(null);
    } catch (e) {
      setFailed(e instanceof Error ? e.message : String(e));
    } finally {
      busy.current = false;
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const rows = useMemo(() => manageRows(MANIFEST, data), [data]);
  const problems = [...(failed ? [failed] : []), ...(data?.problems ?? [])];
  const info = (id: string) => {
    const a = catalog.agents.find((x) => x.id === id);
    const p = catalog.projects.find((x) => x.id === a?.projectId);
    return { name: a?.name ?? id, building: p?.name ?? "No building", projectId: p?.id ?? null };
  };
  // Same building the map shows: switch to the map with it selected.
  const showOnMap = (projectId: string) => {
    setView("map");
    select({ kind: "project", id: projectId });
  };

  return (
    <section className="manage" aria-labelledby="manage-title">
      <div className="manage-head">
        <div className="grow">
          <h2 id="manage-title">Manage agents</h2>
          <p className="muted small">
            {MANIFEST.agents.length} agents that run on GitHub Actions in {MANIFEST.repository}. Times are UTC.
          </p>
        </div>
        <span className="muted small" aria-live="polite">
          {loading ? "Checking GitHub…" : data ? `Checked ${relative(data.fetchedAt)}` : ""}
        </span>
        <button className="btn" onClick={() => void refresh()} disabled={loading} aria-label="Refresh agent status from GitHub">
          <Icon name="refresh" size={14} /> Refresh
        </button>
      </div>

      <div className="notice manage-note" role="note">
        <Icon name={mode === "ready" ? "key" : "lock"} size={14} />
        {mode === "web" ? (
          <span>
            <strong>Read-only here.</strong> Enable, disable and Run now work in the Mac app, where each change asks for confirmation and Touch ID and is logged.
          </span>
        ) : mode === "no-token" ? (
          <span>
            <strong>Controls are off.</strong> Save a Manage agents token in Settings → Actions to enable, disable and run these agents.{" "}
            <button className="text-btn" onClick={() => setView("settings")}>
              Open Settings
            </button>
          </span>
        ) : (
          <span>
            <strong>Controls are on.</strong> Open an agent's details to enable, disable or run it. Each change shows before and after, asks for Touch ID and is written to the audit log. Schedule
            and cap changes open a pull request, so nothing changes until you merge it.
          </span>
        )}
      </div>

      {problems.length > 0 && (
        <div className="notice bad manage-note" role="alert">
          <Icon name="alert" size={14} />
          <span>
            <strong>Some live data is missing.</strong> {problems.join(" ")} Showing schedules and caps from Atlas itself; anything marked Unknown wasn't read.
          </span>
        </div>
      )}

      <div className="card manage-card">
        <table className="table manage-table">
          <thead>
            <tr>
              <th scope="col">Agent</th>
              <th scope="col">Status</th>
              <th scope="col">Schedule</th>
              <th scope="col">Last run</th>
              <th scope="col">Spend this month</th>
              <th scope="col">
                <span className="sr-only">Details</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const { name, building, projectId } = info(r.agent.id);
              const on = expanded === r.agent.id;
              const toggle = () => setExpanded(on ? null : r.agent.id);
              return (
                <Fragment key={r.agent.id}>
                  <tr className={on ? "selected" : ""} onClick={toggle}>
                    <td data-label="Agent">
                      <div className="name">{name}</div>
                      {projectId ? (
                        <button
                          className="text-btn manage-building"
                          onClick={(e) => {
                            e.stopPropagation();
                            showOnMap(projectId);
                          }}
                          aria-label={`Show ${building} on the map`}
                        >
                          <Icon name="map" size={12} /> {building}
                        </button>
                      ) : (
                        <div className="muted small">{building}</div>
                      )}
                    </td>
                    <td data-label="Status">
                      <span className={`status ${STATUS_CLASS[r.status]}`}>{MANAGE_STATUS_LABEL[r.status]}</span>
                    </td>
                    <td data-label="Schedule">
                      <div>{r.schedule}</div>
                      <div className="muted small">
                        {r.agent.alsoRuns ? `Also ${r.agent.alsoRuns}` : ""}
                        {r.nextRunAt ? `${r.agent.alsoRuns ? " · " : ""}Next ${nextLabel(r.nextRunAt)}` : ""}
                      </div>
                    </td>
                    <td data-label="Last run">
                      {r.lastRun ? (
                        <>
                          <div>{relative(r.lastRun.createdAt)}</div>
                          <div className="muted small">
                            {runResult(r.lastRun)} · {EVENT_LABEL[r.lastRun.event] ?? r.lastRun.event}
                          </div>
                        </>
                      ) : (
                        <span className="muted">{r.runs ? "None yet" : "Unknown"}</span>
                      )}
                    </td>
                    <td data-label="Spend this month">
                      {r.agent.cap ? (
                        <>
                          <div>Not reported yet</div>
                          <div className="muted small">Cap {usd(r.agent.cap.usd)} a month</div>
                        </>
                      ) : (
                        <span className="muted">No paid calls</span>
                      )}
                    </td>
                    <td className="manage-toggle">
                      <button
                        className="text-btn"
                        aria-expanded={on}
                        aria-controls={`manage-${r.agent.id}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          toggle();
                        }}
                      >
                        {on ? "Hide" : "Details"}
                        <span className="sr-only"> for {name}</span>
                      </button>
                    </td>
                  </tr>
                  {on && (
                    <tr className="manage-detail-row">
                      <td colSpan={6} id={`manage-${r.agent.id}`}>
                        <Detail row={r} name={name} open={open} mode={mode} refresh={refresh} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="muted small manage-foot">
        Only agents on Atlas's allow-list appear here. Status and runs come from GitHub when this view opens or you press Refresh; nothing checks in the background.
      </p>
    </section>
  );
}

function Detail({ row: r, name, open, mode, refresh }: { row: ManageRow; name: string; open: (id: string) => void; mode: Mode; refresh: () => Promise<void> }) {
  const repo = MANIFEST.repository;
  const wfUrl = `https://github.com/${repo}/actions/workflows/${r.agent.workflow}`;
  return (
    <div className="manage-detail">
      {mode === "ready" && <Controls row={r} name={name} refresh={refresh} />}
      {mode === "ready" && <ConfigForms row={r} name={name} />}
      <div className="manage-detail-links">
        <ExternalLink href={wfUrl}>Workflow on GitHub</ExternalLink>
        <ExternalLink href={`https://github.com/${repo}/blob/main/.github/workflows/${r.agent.workflow}`}>Schedule file</ExternalLink>
        {r.agent.cap && <ExternalLink href={`https://github.com/${repo}/blob/main/${r.agent.cap.file}`}>Cap in {r.agent.cap.file.split("/").pop()}</ExternalLink>}
        <button className="text-btn" onClick={() => open(r.agent.id)}>
          Open {name} in the registry
        </button>
      </div>
      <h3 className="manage-sub">Recent runs on main</h3>
      {!r.runs ? (
        <div className="na-block">Runs couldn't be read from GitHub. Try Refresh.</div>
      ) : r.runs.length === 0 ? (
        <div className="na-block">No runs on main yet.</div>
      ) : (
        <table className="table compact runs-table">
          <thead>
            <tr>
              <th scope="col">Started</th>
              <th scope="col">Trigger</th>
              <th scope="col">Result</th>
              <th scope="col">
                <span className="sr-only">Link</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {r.runs.map((run) => (
              <tr key={run.url}>
                <td title={formatDate(run.createdAt)}>{relative(run.createdAt)}</td>
                <td>{EVENT_LABEL[run.event] ?? run.event}</td>
                <td>{runResult(run)}</td>
                <td>
                  <ExternalLink href={run.url}>Open run</ExternalLink>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <h3 className="manage-sub">Latest report</h3>
      <div className="na-block">Reports and monthly spend aren't sent to Atlas yet. The next update adds them; until then the report is on the run page.</div>
    </div>
  );
}

const OP_LABEL: Record<AgentOp, string> = { enable: "Enable", disable: "Disable", run_now: "Run now" };

/**
 * Enable, Disable and Run now. The page only asks: the Mac app reads the workflow again,
 * shows before and after in a macOS dialog, asks for Touch ID, writes the audit log, and
 * refuses if what GitHub reports no longer matches what this page showed.
 */
function Controls({ row: r, name, refresh }: { row: ManageRow; name: string; refresh: () => Promise<void> }) {
  const [busy, setBusy] = useState<AgentOp | null>(null);
  const [result, setResult] = useState<Outcome | { stage: "failed"; message: string } | null>(null);
  const known = r.workflowState !== null;
  const enabled = r.workflowState === "active";

  const go = async (op: AgentOp) => {
    setBusy(op);
    setResult(null);
    try {
      setResult(await actionsApi.agentAction(r.agent.id, op, r.workflowState));
    } catch (e) {
      setResult({ stage: "failed", message: String(e) });
    } finally {
      setBusy(null);
      await refresh();
    }
  };

  const ok = result && (result.stage === "started" || result.stage === "changed");
  return (
    <div className="manage-controls" role="group" aria-label={`Controls for ${name}`}>
      {known ? (
        <>
          <button className="btn" disabled={!!busy} onClick={() => void go(enabled ? "disable" : "enable")}>
            <Icon name={enabled ? "pause" : "play"} size={13} /> {busy === "disable" || busy === "enable" ? "Waiting for approval…" : OP_LABEL[enabled ? "disable" : "enable"]}
          </button>
          <button className="btn primary" disabled={!!busy || !enabled} onClick={() => void go("run_now")} title={enabled ? undefined : "Enable this agent before running it"}>
            <Icon name="play" size={13} /> {busy === "run_now" ? "Waiting for approval…" : "Run now"}
          </button>
        </>
      ) : (
        <span className="muted small">Controls need the agent's current state from GitHub. Press Refresh.</span>
      )}
      <span className={`small ${result ? (ok ? "manage-ok" : "manage-bad") : "muted"}`} aria-live="polite">
        {result ? result.message : "Changes ask for confirmation and Touch ID."}
      </span>
    </div>
  );
}

/** Plain words for a schedule the person is typing, or null while it doesn't parse. */
function scheduleWords(text: string): string | null {
  try {
    parseCron(text);
    return describeCron(text);
  } catch {
    return null;
  }
}

/** Change schedule and Change cap. Each opens a pull request; the page checks the value as it's typed and Rust checks it again. */
function ConfigForms({ row: r, name }: { row: ManageRow; name: string }) {
  const a = r.agent;
  const [schedule, setSchedule] = useState(a.schedule);
  const [cap, setCap] = useState(a.cap ? a.cap.usd.toFixed(2) : "");
  const [busy, setBusy] = useState<ConfigChange["field"] | null>(null);
  const [result, setResult] = useState<ConfigOutcome | { stage: "failed"; message: string; url?: null } | null>(null);

  const sText = schedule.trim();
  const sProblem = sText === a.schedule ? null : scheduleProblem(a, sText);
  const sChanged = sText !== a.schedule;
  const capNum = cap.trim() === "" ? NaN : Number(cap);
  const cProblem = a.cap && cap.trim() !== a.cap.usd.toFixed(2) ? capProblem(a.cap, capNum) : null;
  const cChanged = !!a.cap && Number.isFinite(capNum) && Math.abs(capNum - a.cap.usd) > 1e-9;

  const submit = async (change: ConfigChange) => {
    setBusy(change.field);
    setResult(null);
    try {
      setResult(await actionsApi.agentConfigChange(a.id, change));
    } catch (e) {
      setResult({ stage: "failed", message: String(e) });
    } finally {
      setBusy(null);
    }
  };
  const ok = result?.stage === "opened";
  const sid = `sched-${a.id}`;
  const cid = `cap-${a.id}`;

  return (
    <div className="manage-config" role="group" aria-label={`Change ${name}'s schedule or cap`}>
      <form
        className="manage-config-row"
        onSubmit={(e) => {
          e.preventDefault();
          if (sChanged && !sProblem) void submit({ field: "schedule", value: sText });
        }}
      >
        <label htmlFor={sid}>Schedule (cron, UTC)</label>
        <input id={sid} className="mono" value={schedule} onChange={(e) => setSchedule(e.target.value)} spellCheck={false} autoComplete="off" aria-invalid={!!sProblem} aria-describedby={`${sid}-hint`} />
        <button className="btn" type="submit" disabled={!!busy || !sChanged || !!sProblem}>
          {busy === "schedule" ? "Waiting for approval…" : "Open pull request"}
        </button>
        <span id={`${sid}-hint`} className={`small ${sProblem ? "manage-bad" : "muted"}`}>
          {sProblem ?? (sChanged ? `New: ${scheduleWords(sText) ?? sText}. Was: ${scheduleWords(a.schedule) ?? a.schedule}.` : `Now: ${scheduleWords(a.schedule) ?? a.schedule}. At least ${a.paid ? "4 hours" : "15 minutes"} between runs.`)}
        </span>
      </form>
      {a.cap && (
        <form
          className="manage-config-row"
          onSubmit={(e) => {
            e.preventDefault();
            if (cChanged && !cProblem) void submit({ field: "cap", value: capNum });
          }}
        >
          <label htmlFor={cid}>Monthly cap (USD)</label>
          <input id={cid} inputMode="decimal" value={cap} onChange={(e) => setCap(e.target.value)} autoComplete="off" aria-invalid={!!cProblem} aria-describedby={`${cid}-hint`} />
          <button className="btn" type="submit" disabled={!!busy || !cChanged || !!cProblem}>
            {busy === "cap" ? "Waiting for approval…" : "Open pull request"}
          </button>
          <span id={`${cid}-hint`} className={`small ${cProblem ? "manage-bad" : "muted"}`}>
            {cProblem ?? (cChanged ? `New: ${usd(capNum)} a month. Was: ${usd(a.cap.usd)}.` : `Now: ${usd(a.cap.usd)} a month. At most ${usd(Math.min(a.cap.maxUsd, HARD_MAX_CAP_USD))}.`)}
          </span>
        </form>
      )}
      <span className={`small ${result ? (ok ? "manage-ok" : "manage-bad") : "muted"}`} aria-live="polite">
        {result ? (
          <>
            {result.message}{" "}
            {ok && result.url && <ExternalLink href={result.url}>Review the pull request</ExternalLink>}
          </>
        ) : (
          "Atlas opens a pull request with the before and after. Nothing changes until you merge it."
        )}
      </span>
    </div>
  );
}
