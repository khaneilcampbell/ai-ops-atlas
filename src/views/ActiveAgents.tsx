import { useEffect, useMemo, useState } from "react";
import { Icon } from "../components/Icon";
import { ExternalLink } from "../components/bits";
import { useActions } from "../actions/state";
import { useProposals } from "../approvals/state";
import { useIntel } from "../intel/state";
import { repoData } from "../lib/derive";
import { load, save } from "../lib/storage";
import { relative } from "../lib/time";
import { activeRows, activeSummary, costOf, docUrl, scheduleOf, type ActiveRow, type ActiveScope } from "../registry/active";
import { buildRegistry } from "../registry/registry";
import { useAtlas } from "../state";
import { AutonomyMeter, ClassBadge, NA, RiskPill } from "./agents/parts";
import { RUNTIME_LABEL, runtimeFor, type Runtime } from "./office/model";
import "../styles/registry.css";
import "../styles/active.css";

const RESULT_LABEL = {
  success: "succeeded",
  failure: "failed",
  running: "in progress",
  other: "ended",
} as const;

/**
 * Mission Control's Active agents tab: what is switched on, what is running right now, and the
 * essentials for each one. Read-only, and every value names its source or says it has none.
 */
export function ActiveAgents() {
  const { catalog, repos, select, setView } = useAtlas();
  const { status: intel } = useIntel();
  const actions = useActions();
  const pending = useProposals();
  const [scope, setScope] = useState<ActiveScope>(() => load<ActiveScope>("mission-active-scope", "on"));
  useEffect(() => save("mission-active-scope", scope), [scope]);

  const entries = useMemo(() => buildRegistry(catalog, repos, intel), [catalog, repos, intel]);
  const runtimes = useMemo(() => {
    const data = {
      available: actions.available,
      status: actions.status,
      audit: actions.audit,
    };
    const byId = new Map(catalog.agents.map((a) => [a.id, a]));
    return new Map<string, Runtime>(entries.map((e) => [e.profile.id, runtimeFor(byId.get(e.profile.id)!, e.telemetry, data, pending.filter((p) => p.agentId === e.profile.id).length)]));
  }, [entries, catalog.agents, actions.available, actions.status, actions.audit, pending]);
  const onRows = useMemo(() => activeRows(entries, runtimes, "on"), [entries, runtimes]);
  const rows = useMemo(() => (scope === "on" ? onRows : activeRows(entries, runtimes, "all")), [scope, onRows, entries, runtimes]);
  const s = activeSummary(onRows);

  const open = (id: string) => {
    select({ kind: "agent", id });
    setView("agents");
  };

  return (
    <>
      <div className="grid kpis aa-kpis">
        <Stat label="Switched on" value={s.switchedOn} sub={`of ${entries.length} registered · marked active in manifests`} />
        <Stat label="Running now" value={s.running} sub={s.running ? "A run was in progress at the last sync" : "No run in progress at the last sync"} tone={s.running ? "live" : undefined} />
        <Stat label="Awaiting approval" value={s.awaiting} sub={actions.available ? "Proposals waiting for you" : "Proposals live in the desktop app"} tone={s.awaiting ? "warn" : undefined} />
        <Stat label="Latest run failed" value={s.failed} sub="Most recent completed run failed" tone={s.failed ? "bad" : undefined} />
        <Stat label="No live source" value={s.unobserved} sub="Switched on, but nothing reports its runs to Atlas" />
      </div>

      <div className="aa-toolbar">
        <p className="muted small grow">
          Switched on is what each manifest says. Running is shown only when Atlas has seen a run in progress, from GitHub Actions, the app's run log or its action audit log.
        </p>
        <div className="seg" role="tablist" aria-label="Which agents">
          <button role="tab" aria-selected={scope === "on"} className={scope === "on" ? "on" : ""} onClick={() => setScope("on")}>
            Switched on · {onRows.length}
          </button>
          <button role="tab" aria-selected={scope === "all"} className={scope === "all" ? "on" : ""} onClick={() => setScope("all")}>
            All agents · {entries.length}
          </button>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="card empty">No agents are marked active in the catalog.</div>
      ) : (
        <div className="aa-grid">
          {rows.map((r) => (
            <AgentCard key={r.entry.profile.id} row={r} branch={repoData(repos[r.entry.profile.repository])?.defaultBranch ?? "HEAD"} open={open} />
          ))}
        </div>
      )}
    </>
  );
}

function Stat({ label, value, sub, tone }: { label: string; value: number; sub: string; tone?: "live" | "warn" | "bad" }) {
  return (
    <div className={`card tile aa-stat ${tone ?? ""}`}>
      <div className="eyebrow">{label}</div>
      <div className="num">{value}</div>
      <div className="sub">{sub}</div>
    </div>
  );
}

function AgentCard({ row, branch, open }: { row: ActiveRow; branch: string; open: (id: string) => void }) {
  const { entry, runtime, switchedOn } = row;
  const { profile: p, telemetry: t } = entry;
  const last = t.lastAnyRun;
  const cost = costOf(entry);
  const schedule = scheduleOf(entry);
  const done = t.executions.filter((e) => !e.offMainline && (e.result === "success" || e.result === "failure")).length;
  return (
    <article className={`card aa-card rt-${runtime.state}`}>
      <header className="aa-head">
        <span className={`aa-dot rt-${runtime.state}`} aria-hidden />
        <div className="grow aa-title">
          <button className="text-btn aa-name" onClick={() => open(p.id)} title="Open in the agent registry">
            {p.title}
          </button>
          <div className="meta">
            {p.project.name} · <ExternalLink href={p.repositoryUrl}>{p.repository}</ExternalLink>
          </div>
        </div>
        <span className={`rt-pill rt-${runtime.state}`} title={runtime.reason}>
          {RUNTIME_LABEL[runtime.state]}
        </span>
      </header>

      <p className="aa-summary">{p.summary}</p>

      <div className="aa-tags">
        <ClassBadge c={p.classification} />
        {!switchedOn && <span className="aa-flag">Marked {entry.status} in its manifest</span>}
        <RiskPill risk={p.governance.risk} />
      </div>

      <dl className="kv aa-kv">
        <dt>Status</dt>
        <dd>
          {runtime.reason}
          {runtime.source && <span className="muted"> · {runtime.source}</span>}
        </dd>
        <dt>Last run</dt>
        <dd>
          {last ? (
            <>
              {last.url ? <ExternalLink href={last.url}>{relative(last.at)}</ExternalLink> : relative(last.at)} · {RESULT_LABEL[last.result]}
              {t.successRate !== null && (
                <span className="muted">
                  {" "}
                  · {Math.round(t.successRate * 100)}% of {done} succeeded
                </span>
              )}
            </>
          ) : (
            <NA kind={t.source ? "verified" : "connected"} />
          )}
        </dd>
        <dt>When it runs</dt>
        <dd>
          {schedule ?? <NA />}
          {schedule && <span className="muted"> · next run not computed, the schedule is documented as text</span>}
        </dd>
        <dt>Runs on</dt>
        <dd>{[p.execution.environment, p.model].filter(Boolean).join(" · ") || <NA />}</dd>
        <dt>Autonomy</dt>
        <dd>
          <AutonomyMeter level={p.governance.autonomy} />
        </dd>
        <dt>Approval</dt>
        <dd>{p.governance.approval ?? <NA />}</dd>
        <dt>Cost</dt>
        <dd>
          {cost ? (
            <>
              {cost.value}
              <span className="muted"> · {cost.basis === "observed" ? "estimated from the app's run log" : "as documented"}</span>
            </>
          ) : (
            <NA />
          )}
        </dd>
      </dl>

      <footer className="aa-links">
        <button className="text-btn small" onClick={() => open(p.id)}>
          <Icon name="agents" size={13} /> Full profile
        </button>
        {p.docs.runbook && <ExternalLink href={docUrl(p.docs.runbook, p.repository, branch)}>Runbook</ExternalLink>}
        {p.docs.source && <ExternalLink href={docUrl(p.docs.source, p.repository, branch)}>Source</ExternalLink>}
        {last?.url && <ExternalLink href={last.url}>Latest run</ExternalLink>}
      </footer>
    </article>
  );
}
