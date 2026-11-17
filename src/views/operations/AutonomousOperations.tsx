import { useEffect, useMemo, useState } from "react";
import { spend } from "../../execution/policy";
import { AUTONOMY_INFO } from "../../executive/types";
import { useExecutive } from "../../executive/store";
import { formatDateTime } from "../../lib/timezone";
import { useOperationsRound, siteStop } from "../../operations/app";
import { createIncidentTask } from "../../operations/engine";
import { bySeverity, isOpen } from "../../operations/incidents";
import { incidentRecommendations, operationalInsights } from "../../operations/insights";
import { PLAYBOOKS } from "../../operations/playbooks";
import { authorizeRecovery } from "../../operations/policy";
import { executePlaybook, pickPlaybook } from "../../operations/recovery";
import { audit, opsStore, useOps } from "../../operations/store";
import { IDENTITY_LABEL, INCIDENT_STATE_LABEL, METRICS, SEVERITY_LABEL, type Incident, type Metric } from "../../operations/types";
import { INCIDENT_PREFIX } from "../../operations/workflow";
import { useAtlas } from "../../state";
import { focusTasks } from "../../tasks/focus";
import { cancel, liveAttempt } from "../../tasks/lifecycle";
import { taskService, useTasks } from "../../tasks/store";
import { KHANEIL } from "../../tasks/types";
import { focusWorkflowRun } from "../../workflows/selection";
import "../../styles/operations.css";

// Mission Control > Autonomous operations (Phase 9). What Atlas detected, grouped and did about it,
// under Khaneil's autonomy level and policies, with the emergency stop. Everything shown is read
// from this device's operations records and the Task Center; nothing here calls a model.

const METRIC_LABEL: Record<Metric, string> = {
  events_received: "Events received",
  events_rejected: "Events rejected (schema or source)",
  events_duplicate: "Repeat reports ignored",
  incidents_created: "Incidents created",
  incidents_reopened: "Incidents reopened",
  tasks_created: "Incident tasks created",
  policies_evaluated: "Policy checks",
  actions_dispatched: "Recovery actions dispatched",
  actions_refused: "Actions refused",
  recovery_attempts: "Recovery attempts",
  verifications_passed: "Verifications passed",
  verifications_failed: "Verifications failed",
  approvals_requested: "Approvals requested",
  escalations: "Escalations",
  stops: "Emergency stops",
  resumes: "Resumes",
  model_calls: "Model calls",
};

const DAY = 86_400_000;

export function AutonomousOperations() {
  const { catalog, setView } = useAtlas();
  const ops = useOps();
  const exec = useExecutive();
  const tasks = useTasks();
  const round = useOperationsRound();
  const [msg, setMsg] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [site, setSite] = useState<{ active: boolean; reason: string } | null>(null);
  const now = Date.now();
  const level = exec.autonomy;
  const store = opsStore();

  useEffect(() => {
    void siteStop
      .read()
      .then(setSite)
      .catch(() => setSite(null));
  }, [ops.stop?.active]);

  const incidents = useMemo(() => [...ops.incidents].sort((a, b) => Number(isOpen(b)) - Number(isOpen(a)) || bySeverity(a, b)), [ops.incidents]);
  const open = incidents.filter(isOpen);
  const insights = useMemo(() => operationalInsights(ops, tasks, now), [ops, tasks, now]);
  const events24 = ops.events.filter((e) => now - Date.parse(e.at) <= DAY);
  const verified = incidents.filter((i) => i.state === "resolved" && i.verified).slice(0, 5);
  const approvals = tasks.filter((t) => t.status === "awaiting_approval");
  const waitingOnOwner = open.filter((i) => i.state === "escalated" || (pickPlaybook(i) && !i.attemptIds.length && level < 3));
  const running = tasks.filter((t) => t.status === "running" && (t.createdBy.kind !== "person" || t.source === "system"));
  const external = tasks.filter((t) => {
    const a = liveAttempt(t);
    return a && a.executor !== "manual";
  });
  const queued = tasks.filter((t) => t.status === "queued").length;
  const week = tasks.filter((t) => now - Date.parse(t.updatedAt) <= 7 * DAY).map(spend);
  const billed = week.reduce((s, x) => s + x.billedUsd, 0);
  const estimated = week.reduce((s, x) => s + x.estimatedUsd, 0);
  const opsModelUsd = ops.attempts.reduce((s, a) => s + a.modelUsd, 0);
  const activePolicies = PLAYBOOKS.filter((p) => ops.policies[p.id]?.enabled);
  const stopped = !!ops.stop?.active || !!site?.active;

  const toggleStop = async () => {
    if (ops.stop?.active) {
      const err = store.setStop(KHANEIL, false, reason || "Resumed by Khaneil");
      if (err) return setMsg(err);
      if (siteStop.available()) store.setSiteState(await siteStop.set(false, reason || "Resumed by Khaneil"));
      setReason("");
      return setMsg("Resumed. Atlas follows your autonomy level and policies again.");
    }
    const why = reason.trim() || "Stopped from Mission Control";
    const err = store.setStop(KHANEIL, true, why);
    if (err) return setMsg(err);
    const s = await siteStop.set(true, why);
    store.setSiteState(s);
    setMsg(s === "confirmed" ? "Stopped. The site confirmed it will refuse new n8n step sends too." : s === "not_reached" ? "Stopped on this device. The site didn't confirm, so sends from another device may still go out." : "Stopped on this device. The site-wide stop is set from the web page.");
  };

  const runPlaybook = async (i: Incident) => {
    const pb = pickPlaybook(i);
    if (!pb) return;
    const r = await executePlaybook({ store, adapters: round.adapters, level }, i.id, pb.id, KHANEIL);
    setMsg(r.ok ? `${pb.name}: ${r.attempt.detail}` : r.error);
  };
  const makeTask = (i: Incident) => {
    const r = createIncidentTask({ store, level, catalog, createTask: (input, actor) => taskService().create(input, actor) }, i.id, KHANEIL);
    setMsg(r.ok ? "Incident task created in the Task Center." : r.error);
  };
  const dismissIncident = (i: Incident) => store.update((f) => audit({ ...f, incidents: f.incidents.map((x) => (x.id === i.id ? { ...x, state: "dismissed" as const, resolvedAt: new Date().toISOString(), resolution: "Dismissed by Khaneil." } : x)) }, KHANEIL.name, "incident_dismissed", i.key));
  const openTask = (id: string) => {
    focusTasks({ query: id });
    setView("tasks");
  };
  const openWorkflow = (i: Incident) => {
    focusWorkflowRun(`${INCIDENT_PREFIX}${i.id}`, i.id);
    setView("workflows");
  };
  const requestCancel = (taskId: string) => {
    const r = taskService().apply(taskId, (t, _a, at) => cancel(t, KHANEIL, at, "Emergency stop"));
    setMsg(r.ok ? "Stop requested. It counts as stopped only when the outside system confirms." : r.error);
  };

  return (
    <section className="card ops" aria-label="Autonomous operations">
      <div className="card-head ops-head">
        <h2 className="grow">Autonomous operations</h2>
        <span className="chip">{AUTONOMY_INFO[level].name}</span>
        <input className="ops-reason" aria-label="Reason" placeholder={ops.stop?.active ? "Reason to resume (optional)" : "Reason to stop (optional)"} value={reason} onChange={(e) => setReason(e.target.value)} />
        <button className={`btn small ${ops.stop?.active ? "primary" : "danger"}`} onClick={() => void toggleStop()}>
          {ops.stop?.active ? "Resume operations" : "Emergency stop"}
        </button>
      </div>
      <p className="muted small ops-pad">
        Atlas turns verified events into incidents and tasks, and runs an approved read-only playbook on its own only when you enabled its policy and autonomy is level 3. At level {level} {level < 3 ? "it recommends; you start recovery." : "enabled policies may run."} No model is called for monitoring.
      </p>
      {stopped && (
        <div className="ops-stop" role="status">
          <strong>Emergency stop is on.</strong> {ops.stop?.active ? `Set by ${ops.stop.by} ${formatDateTime(ops.stop.at)}${ops.stop.reason ? `: ${ops.stop.reason}` : ""}.` : `Set on the site${site?.reason ? `: ${site.reason}` : ""}.`} No new autonomous dispatch, no automatic retry; {queued} queued step{queued === 1 ? "" : "s"} held. Audit, monitoring and your access keep working.
          {ops.stop?.site === "confirmed" && " The site refuses new n8n step sends too."}
          {ops.stop?.site === "not_reached" && " The site didn't confirm its stop."}
        </div>
      )}
      {msg && <p className="task-error ops-pad">{msg}</p>}

      <div className="ops-tiles">
        <Tile label="Events · 24 h" value={events24.length} sub={`${ops.counters.events_rejected} rejected all time`} />
        <Tile label="Open incidents" value={open.length} sub={`${open.filter((i) => i.severity === "critical" || i.severity === "high").length} high or critical`} tone={open.some((i) => i.severity === "critical" || i.severity === "high") ? "bad" : undefined} />
        <Tile label="Recovery attempts" value={ops.attempts.filter((a) => a.outcome !== "refused").length} sub={`${ops.counters.verifications_passed} verified fixes`} />
        <Tile label="Waiting for you" value={approvals.length + waitingOnOwner.length} sub={`${approvals.length} task approvals · ${waitingOnOwner.length} incidents`} />
        <Tile label="Model spend · 7 days" value={`$${(billed + estimated).toFixed(2)}`} sub={`${estimated ? `$${estimated.toFixed(2)} estimated · ` : ""}operations used $${opsModelUsd.toFixed(2)}`} />
      </div>

      <div className="ops-grid">
        <div className="ops-col">
          <h3 className="exec-h">Incidents</h3>
          {incidents.length === 0 && <p className="muted small">No incidents. Atlas watches agent alerts, n8n and GitHub runs, connected signals, Task Center runs and your goals.</p>}
          {incidents.slice(0, 12).map((i) => {
            const pb = pickPlaybook(i);
            const tries = ops.attempts.filter((a) => a.incidentId === i.id);
            const can = pb ? authorizeRecovery({ level, actor: KHANEIL, playbook: pb, policy: ops.policies[pb.id], incident: i, stop: ops.stop, attempts: ops.attempts, toolProblem: round.adapters[pb.adapter].problem(i), now }) : null;
            const recs = incidentRecommendations(i, insights, !!pb);
            return (
              <div key={i.id} className={`ops-inc sev-${i.severity}${isOpen(i) ? "" : " closed"}`}>
                <button className="ops-inc-top" aria-expanded={openId === i.id} onClick={() => setOpenId(openId === i.id ? null : i.id)}>
                  <span className="ops-inc-title">{i.title}</span>
                  <span className="ops-inc-meta">
                    <span className={`chip ops-sev sev-${i.severity}`}>{SEVERITY_LABEL[i.severity]}</span>
                    <span className="chip">{INCIDENT_STATE_LABEL[i.state]}</span>
                    {i.verified && <span className="chip ops-ok">Verified</span>}
                    <span className="muted small">
                      {i.systems.join(", ")} · {i.count} report{i.count === 1 ? "" : "s"} · {formatDateTime(i.lastAt)}
                    </span>
                  </span>
                </button>
                {openId === i.id && (
                  <div className="ops-inc-body">
                    <ul className="ops-evidence">
                      {i.evidence.map((e, n) => (
                        <li key={n}>
                          <strong>{e.system}</strong> · {e.detail}
                          <span className="muted small"> · {IDENTITY_LABEL[e.identity]}</span>
                          {e.url && (
                            <>
                              {" · "}
                              <a href={e.url} target="_blank" rel="noreferrer">
                                Evidence
                              </a>
                            </>
                          )}
                        </li>
                      ))}
                    </ul>
                    {i.impact.length > 0 && <p className="small">Affects: {i.impact.join("; ")}</p>}
                    {i.escalation && <p className="small task-error">Escalated: {i.escalation.reason}</p>}
                    {i.resolution && <p className="small muted">{i.resolution}</p>}
                    {tries.length > 0 && (
                      <ol className="ops-attempts">
                        {tries.map((a) => (
                          <li key={a.id} className="small">
                            {PLAYBOOKS.find((p) => p.id === a.playbookId)?.name} · {a.actor.name} · {a.outcome}
                            {a.verification ? ` · verification ${a.verification.state}` : ""} · {a.detail}
                          </li>
                        ))}
                      </ol>
                    )}
                    {recs.length > 0 && (
                      <ul className="small ops-recs">
                        {recs.map((r) => (
                          <li key={r}>{r}</li>
                        ))}
                      </ul>
                    )}
                    {isOpen(i) && (
                      <div className="exec-actions">
                        {pb && (
                          <button className="btn small primary" disabled={!can?.allowed} title={can && !can.allowed ? can.reason : pb.description} onClick={() => void runPlaybook(i)}>
                            Run: {pb.name}
                          </button>
                        )}
                        {pb && can && !can.allowed && <span className="muted small">{can.reason}</span>}
                        {!pb && <span className="muted small">No approved playbook fits. Investigate through its task.</span>}
                        {i.incidentTaskId ? (
                          <button className="btn small" onClick={() => openTask(i.incidentTaskId!)}>
                            Open task
                          </button>
                        ) : (
                          <button className="btn small" onClick={() => makeTask(i)}>
                            Create task
                          </button>
                        )}
                        <button className="btn small" onClick={() => openWorkflow(i)}>
                          Workflow Intelligence
                        </button>
                        <button className="btn small" onClick={() => dismissIncident(i)}>
                          Dismiss
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}

          <h3 className="exec-h">Recent events</h3>
          {ops.events.length === 0 ? (
            <p className="muted small">None recorded on this device yet.</p>
          ) : (
            <ul className="list ops-events">
              {[...ops.events].reverse().slice(0, 8).map((e) => (
                <li key={e.id} className="list-row">
                  <div className="grow">
                    <div className="title">{String(e.payload.title ?? e.type)}</div>
                    <div className="meta">
                      {e.type} · {e.system} · {SEVERITY_LABEL[e.severity]} · {formatDateTime(e.at)}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="ops-col">
          <h3 className="exec-h">Approved policies · {activePolicies.length} of {PLAYBOOKS.length} on</h3>
          <ul className="list ops-policies">
            {PLAYBOOKS.map((p) => {
              const pol = ops.policies[p.id];
              return (
                <li key={p.id} className="list-row">
                  <label className="grow ops-policy">
                    <input
                      type="checkbox"
                      checked={!!pol?.enabled}
                      onChange={(e) => {
                        const err = store.setPolicy(KHANEIL, { ...pol, enabled: e.target.checked });
                        setMsg(err);
                      }}
                    />
                    <span>
                      <span className="title">{p.name}</span>
                      <span className="meta">
                        {p.description} At most {pol?.maxRetries ?? p.retry.max} tries an incident, {pol?.perHour} an hour. {p.sideEffect === "none" ? "Read-only." : "Changes only this device's cache or queue."}
                      </span>
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
          <p className="muted small">Enabled policies run on their own only at level 3. Deploys, deletes, credential changes, spending, publishing and messages are never playbooks.</p>

          <h3 className="exec-h">Running work</h3>
          {running.length === 0 && external.length === 0 && <p className="muted small">Nothing running.</p>}
          <ul className="list">
            {external.map((t) => (
              <li key={t.id} className="list-row">
                <div className="grow">
                  <div className="title">{t.title}</div>
                  <div className="meta">
                    {t.cancelRequestedAt ? "Stop requested; not confirmed by the outside system yet." : liveAttempt(t)?.executor === "n8n" ? "Running in n8n. Atlas's n8n key is read-only, so it can't be stopped from here." : "Running in GitHub Actions. Cancelling from Atlas isn't built; stop it on GitHub."}
                  </div>
                </div>
                {stopped && !t.cancelRequestedAt && (
                  <button className="btn small" onClick={() => requestCancel(t.id)}>
                    Request stop
                  </button>
                )}
              </li>
            ))}
            {running
              .filter((t) => !external.includes(t))
              .map((t) => (
                <li key={t.id} className="list-row">
                  <div className="grow">
                    <div className="title">{t.title}</div>
                    <div className="meta">Started by {t.createdBy.name}</div>
                  </div>
                </li>
              ))}
          </ul>

          <h3 className="exec-h">Verified outcomes</h3>
          {verified.length === 0 ? (
            <p className="muted small">None yet. An incident counts as fixed only when its source answers again without the problem.</p>
          ) : (
            <ul className="list">
              {verified.map((i) => (
                <li key={i.id} className="list-row">
                  <div className="grow">
                    <div className="title">{i.title}</div>
                    <div className="meta">
                      {i.resolution} · {i.resolvedAt ? formatDateTime(i.resolvedAt) : ""}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}

          <h3 className="exec-h">Operational intelligence</h3>
          {insights.length === 0 ? (
            <p className="muted small">No patterns yet. Counted from recorded incidents, attempts and tasks; no model involved.</p>
          ) : (
            <ul className="list">
              {insights.map((x) => (
                <li key={x.id} className="list-row">
                  <div className="grow">
                    <div className="title">{x.title}</div>
                    <div className="meta">
                      {x.detail} · {x.refs.length} record{x.refs.length === 1 ? "" : "s"}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}

          <details className="ops-audit">
            <summary className="muted small">Observability · {ops.audit.length} audit entries</summary>
            <dl className="ops-metrics">
              {METRICS.map((m) => (
                <div key={m}>
                  <dt>{METRIC_LABEL[m]}</dt>
                  <dd>{ops.counters[m] ?? 0}</dd>
                </div>
              ))}
            </dl>
            <ul className="list">
              {[...ops.audit].reverse().slice(0, 12).map((a, n) => (
                <li key={n} className="list-row">
                  <div className="grow">
                    <div className="title">{a.action.replace(/_/g, " ")}</div>
                    <div className="meta">
                      {a.actor} · {formatDateTime(a.at)}
                      {a.detail ? ` · ${a.detail}` : ""}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </details>
        </div>
      </div>
    </section>
  );
}

function Tile({ label, value, sub, tone }: { label: string; value: number | string; sub: string; tone?: "bad" }) {
  return (
    <div className={`ops-tile${tone ? ` ${tone}` : ""}`}>
      <div className="ops-tile-label">{label}</div>
      <div className="ops-tile-value">{value}</div>
      <div className="muted small">{sub}</div>
    </div>
  );
}
