import { useCallback, useEffect, useMemo, useState } from "react";
import { ExternalLink } from "../components/bits";
import { Icon } from "../components/Icon";
import { useLedgers } from "../execution/ledger";
import { fetchHealth, STATE_LABEL, type HealthLoad, type HealthState } from "../observability/health";
import { releaseSummary, workSummary, type ReleaseState } from "../observability/production";
import { relative } from "../lib/time";
import { useAtlas } from "../state";
import { useTasks } from "../tasks/store";

// Production health inside Mission Control: Operations (service checks, failing work, recovery),
// Security (which credentials are set, the owner allowlist, where refusals are logged) and Release
// (Atlas's own CI on main and how to roll back). Every state comes from a real check; anything
// Atlas couldn't verify says Unknown.

const ATLAS_REPO = "khaneilcampbell/ai-ops-atlas";
const ROLLBACK_DOC = `https://github.com/${ATLAS_REPO}/blob/main/docs/runbooks/stop-and-rollback.md`;
const READINESS_DOC = `https://github.com/${ATLAS_REPO}/blob/main/docs/production-readiness.md`;
const PAGES_LOGS = "https://dash.cloudflare.com/2ff911bc5c9acdcb7f6088b9a25f002f/pages/view/ai-ops-atlas";

const DOT: Record<HealthState, string> = { healthy: "h-good", degraded: "h-warn", unavailable: "h-bad", unknown: "h-unknown" };
const RELEASE_DOT: Record<ReleaseState, string> = { passing: "h-good", failing: "h-bad", running: "h-warn", unknown: "h-unknown" };
const RELEASE_LABEL: Record<ReleaseState, string> = { passing: "Passing", failing: "Failing", running: "Running", unknown: "Unknown" };

function State({ state }: { state: HealthState }) {
  return (
    <span className="health prod-state">
      <i className={DOT[state]} /> {STATE_LABEL[state]}
    </span>
  );
}

export function ProductionHealth() {
  const { repos } = useAtlas();
  const tasks = useTasks();
  const ledgers = useLedgers();
  const [load, setLoad] = useState<HealthLoad>({ kind: "idle" });
  const refresh = useCallback(async () => {
    setLoad({ kind: "loading" });
    setLoad(await fetchHealth());
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  const work = useMemo(() => workSummary(tasks, ledgers), [tasks, ledgers]);
  const repo = repos[ATLAS_REPO];
  const snapshot = repo && repo.kind !== "loading" ? repo.data : undefined;
  const release = useMemo(() => releaseSummary(snapshot?.runs), [snapshot]);
  const report = load.kind === "ok" ? load.report : null;
  const missing = report?.credentials.filter((c) => !c.configured) ?? [];

  return (
    <section className="prod-health" aria-label="Production health">
      <div className="card-head prod-head">
        <h2 className="grow">Production health</h2>
        {report && <State state={report.overall} />}
        <button className="ghost-btn dark" onClick={() => void refresh()} disabled={load.kind === "loading"}>
          <Icon name="refresh" size={14} /> {load.kind === "loading" ? "Checking" : "Check now"}
        </button>
      </div>
      <div className="grid prod-grid">
        <section className="card">
          <div className="card-head">
            <h3 className="grow">Operations</h3>
            {report && <span className="muted small">checked {relative(report.checkedAt)}</span>}
          </div>
          {load.kind === "ok" ? (
            <ul className="prod-list">
              {load.report.checks.map((c) => (
                <li key={c.id}>
                  <State state={c.state} />
                  <div className="grow">
                    <div className="label">{c.label}</div>
                    <div className="muted small">{c.detail}</div>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted small prod-pad">
              {load.kind === "loading" || load.kind === "idle" ? "Checking the site and its integrations…" : <>Service health is unknown: {load.message}</>}
            </p>
          )}
          <div className="prod-stats">
            <div>
              <b className={work.failed ? "bad" : ""}>{work.failed}</b>
              <span>Failed tasks</span>
            </div>
            <div>
              <b>{work.running}</b>
              <span>Running</span>
            </div>
            <div>
              <b>{work.awaitingApproval}</b>
              <span>Awaiting approval</span>
            </div>
            <div>
              <b className={work.needsReconcile ? "bad" : ""}>{work.needsReconcile}</b>
              <span>Sends to check</span>
            </div>
            <div>
              <b>{report?.metrics.workflowSuccessRate == null ? "—" : `${Math.round(report.metrics.workflowSuccessRate * 100)}%`}</b>
              <span>n8n success</span>
            </div>
          </div>
          <div className="card-foot muted small">Tasks and sends to check are this device's Task Center and run ledger. A send with no clear answer is never retried by itself: check it in the outside system, then record what happened.</div>
        </section>

        <section className="card">
          <div className="card-head">
            <h3 className="grow">Security</h3>
            {report && <span className="muted small">{report.credentials.length - missing.length} of {report.credentials.length} set</span>}
          </div>
          {report ? (
            <ul className="prod-list">
              {report.credentials.map((c) => (
                <li key={c.id}>
                  <span className="health prod-state">
                    <i className={c.configured ? "h-good" : "h-unknown"} /> {c.configured ? "Set" : "Not set"}
                  </span>
                  <div className="grow">
                    <div className="label">{c.label}</div>
                    <div className="muted small">{c.scope}</div>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted small prod-pad">Credential status is unknown until the site answers.</p>
          )}
          <div className="card-foot muted small">
            Only whether each key is set is shown, never its value. Refused sign-ins and cross-site requests are logged without credentials in the <ExternalLink href={PAGES_LOGS}>site's Cloudflare logs</ExternalLink>. Findings and remaining risks: <ExternalLink href={READINESS_DOC}>production readiness</ExternalLink>.
          </div>
        </section>

        <section className="card">
          <div className="card-head">
            <h3 className="grow">Release</h3>
            <span className="health prod-state">
              <i className={RELEASE_DOT[release.state]} /> {RELEASE_LABEL[release.state]}
            </span>
          </div>
          {release.history.length ? (
            <ul className="prod-list">
              {release.history.map((r) => (
                <li key={r.url}>
                  <span className="health prod-state">
                    <i className={r.status !== "completed" ? "h-warn" : r.conclusion === "success" ? "h-good" : r.conclusion === "failure" ? "h-bad" : "h-unknown"} />
                    {r.status !== "completed" ? "Running" : r.conclusion === "success" ? "Shipped" : r.conclusion === "failure" ? "Failed" : (r.conclusion ?? "Unknown")}
                  </span>
                  <div className="grow">
                    <div className="label">
                      <ExternalLink href={r.url}>CI on main</ExternalLink>
                    </div>
                    <div className="muted small">{relative(r.createdAt)}</div>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted small prod-pad">Build history is unknown until GitHub is synced for {ATLAS_REPO}.</p>
          )}
          <div className="card-foot muted small">
            A green CI run on main signs and publishes the Mac update and redeploys the site; a failed run publishes nothing. Roll back by reverting the pull request: the revert ships as a newer build. <ExternalLink href={ROLLBACK_DOC}>Stop and roll back</ExternalLink>
          </div>
        </section>
      </div>
    </section>
  );
}
