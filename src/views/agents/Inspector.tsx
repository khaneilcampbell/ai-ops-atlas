import { useMemo, useState } from "react";
import { Icon } from "../../components/Icon";
import { ExternalLink, StatusPill } from "../../components/bits";
import { attentionItems, repoData } from "../../lib/derive";
import { formatDate, relative } from "../../lib/time";
import type { RegistryEntry } from "../../registry/registry";
import { documentationChecks } from "../../registry/profile";
import { mainline, meetsTarget, observeKpi, OPERATIONAL_LABEL, successTrend } from "../../registry/telemetry";
import { AUTONOMY_INFO, CATEGORY_LABEL, CLASSIFICATION_INFO, TRIGGER_LABEL, type Kpi, type Telemetry } from "../../registry/types";
import { useAtlas } from "../../state";
import { WorkflowControls } from "../../components/OpButton";
import { CatalogEditor } from "./CatalogEditor";
import { AutonomyMeter, CLASS_COLOR, ClassBadge, ListField, NA, OperationalPill, orNA, RiskPill } from "./parts";

type Tab = "overview" | "goals" | "workflow" | "operations" | "governance" | "docs";
const TABS: { id: Tab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "goals", label: "Goals" },
  { id: "workflow", label: "Workflow" },
  { id: "operations", label: "Operations" },
  { id: "governance", label: "Governance" },
  { id: "docs", label: "Documentation" },
];

const SOURCE_LABEL = { github: "GitHub Actions", "atlas-intel": "Atlas run log" } as const;

/**
 * Agent Detail Inspector. Read-only unless KC switched on workflow actions in Settings: then
 * Run, Pause and Resume appear for an agent's GitHub workflow, each behind a native dialog and
 * Touch ID. "Edit details" changes only how this Mac shows the agent.
 */
export function Inspector({ entry }: { entry: RegistryEntry }) {
  const { catalog, repos, manifestIssues, uncataloged, select } = useAtlas();
  const [tab, setTab] = useState<Tab>("overview");
  const { profile: p, telemetry: t } = entry;
  const agent = catalog.agents.find((a) => a.id === p.id)!;
  const snap = repoData(repos[p.repository]);
  const branch = snap?.defaultBranch ?? "HEAD";
  const sourceUrl = (path: string) => `https://github.com/${p.repository}/blob/${branch}/${path}`;
  const flags = useMemo(
    () => attentionItems(catalog, repos, manifestIssues, Date.now(), uncataloged).filter((i) => i.target?.kind === "agent" && i.target.id === p.id),
    [catalog, repos, manifestIssues, uncataloged, p.id],
  );

  const onTabKey = (e: React.KeyboardEvent) => {
    const i = TABS.findIndex((x) => x.id === tab);
    const d = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const next = TABS[(i + d + TABS.length) % TABS.length];
    setTab(next.id);
    document.getElementById(`reg-tab-${next.id}`)?.focus();
  };

  return (
    <section className="card agent-profile reg-inspector" aria-label={p.title}>
      <header className="ap-head">
        <span className="ap-badge" style={{ background: CLASS_COLOR[p.classification] }}>
          <Icon name="agents" size={20} />
        </span>
        <div className="grow">
          <div className="eyebrow">
            {p.project.name} · {CATEGORY_LABEL[p.category]}
            {p.subcategory ? ` · ${p.subcategory}` : ""}
          </div>
          <h2 className="selectable">{p.title}</h2>
          {p.originalName && <div className="muted small selectable">Manifest name: {p.originalName}</div>}
          {p.suggestedTitle && <div className="muted small">Suggested title: {p.suggestedTitle} (not applied)</div>}
          <div className="chips" style={{ marginTop: 8 }}>
            <ClassBadge c={p.classification} long />
            <OperationalPill op={entry.operational} />
            <StatusPill status={entry.status} />
            <RiskPill risk={p.governance.risk} />
            <span className="chip">{p.framework}</span>
          </div>
          {agent.localNote && (
            <div className="local-note small selectable">
              <Icon name="tag" size={12} /> {agent.localNote}
            </div>
          )}
          <div className="agent-actions">
            {agent.observe?.githubWorkflow && <WorkflowControls repo={agent.repository} workflow={agent.observe.githubWorkflow} />}
            <CatalogEditor key={agent.id} agent={agent} />
          </div>
        </div>
      </header>

      {/* The four sections KC wants most visible, always on screen above the tabs. */}
      <div className="essentials selectable">
        <div className="ess">
          <div className="section-title">Mission</div>
          <p>{p.mission.purpose}</p>
          {p.mission.problem && <p className="muted small">{p.mission.problem}</p>}
        </div>
        <div className="ess">
          <div className="section-title">Responsibilities</div>
          {p.responsibilities.tasks.length ? (
            <ul className="reg-list compact">
              {p.responsibilities.tasks.slice(0, 4).map((x) => (
                <li key={x}>{x}</li>
              ))}
              {p.responsibilities.tasks.length > 4 && <li className="muted">and {p.responsibilities.tasks.length - 4} more</li>}
            </ul>
          ) : (
            <NA />
          )}
        </div>
        <div className="ess">
          <div className="section-title">Goals</div>
          <p>{orNA(p.goals.objective)}</p>
          <p className="muted small">{p.goals.kpis.length ? `${p.goals.kpis.length} KPI${p.goals.kpis.length > 1 ? "s" : ""} defined` : "No KPIs defined"}</p>
        </div>
        <div className="ess">
          <div className="section-title">Operational status</div>
          <p>
            <OperationalPill op={entry.operational} />
          </p>
          <p className="muted small">
            {t.lastVerifiedRun ? (
              <>Last verified run {relative(t.lastVerifiedRun.at)}</>
            ) : t.source ? (
              t.loaded ? "No successful run observed" : `${SOURCE_LABEL[t.source]} not loaded yet`
            ) : (
              "No live source connected"
            )}
          </p>
        </div>
      </div>

      <div className="tabs" role="tablist" aria-label="Agent details" onKeyDown={onTabKey}>
        {TABS.map((x) => (
          <button
            key={x.id}
            id={`reg-tab-${x.id}`}
            role="tab"
            aria-selected={tab === x.id}
            aria-controls={`reg-panel-${x.id}`}
            tabIndex={tab === x.id ? 0 : -1}
            className={tab === x.id ? "on" : ""}
            onClick={() => setTab(x.id)}
          >
            {x.label}
            {x.id === "operations" && t.executions.length > 0 && <span className="count-pill">{t.executions.length}</span>}
            {x.id === "operations" && flags.length > 0 && <span className="count-pill warn">{flags.length}</span>}
            {x.id === "docs" && entry.docs.missing.length > 0 && <span className="count-pill">{entry.docs.done}/{entry.docs.total}</span>}
          </button>
        ))}
      </div>

      <div className="ap-body selectable" role="tabpanel" id={`reg-panel-${tab}`} aria-labelledby={`reg-tab-${tab}`}>
        {tab === "overview" && (
          <div className="reg-cols">
            <dl className="kv">
              <dt>Title</dt>
              <dd>{p.title}</dd>
              <dt>Agent ID</dt>
              <dd className="mono">{p.id}</dd>
              <dt>Description</dt>
              <dd>{p.summary}</dd>
              <dt>Agent type</dt>
              <dd>
                Type {p.classification === "unclassified" ? "?" : p.classification} · {CLASSIFICATION_INFO[p.classification].label}
                <div className="muted small">{CLASSIFICATION_INFO[p.classification].description}</div>
              </dd>
              <dt>Classification</dt>
              <dd>
                {p.confidence ? <span className={`conf conf-${p.confidence}`}>{p.confidence}</span> : <NA />}
                {p.evidence && <div className="muted small">{p.evidence}</div>}
              </dd>
              <dt>Project</dt>
              <dd>{p.project.name}</dd>
              <dt>Repository</dt>
              <dd>
                <button className="text-btn inline" onClick={() => select({ kind: "repo", id: p.repository })}>
                  {p.repository}
                </button>
              </dd>
              <dt>Framework</dt>
              <dd>{p.framework}</dd>
              <dt>Model</dt>
              <dd>{orNA(p.model)}</dd>
              <dt>Runtime</dt>
              <dd>{orNA(p.runtime)}</dd>
              <dt>Version</dt>
              <dd>{orNA(p.version)}</dd>
            </dl>
            <div className="reg-stack">
              <ListField title="Expected outcomes" items={p.mission.outcomes} />
              <ListField title="Intended users" items={p.mission.beneficiaries} />
              <ListField title="All responsibilities" items={p.responsibilities.tasks} />
            </div>
          </div>
        )}

        {tab === "goals" && <GoalsTab kpis={p.goals.kpis} objective={p.goals.objective} review={p.goals.reviewFrequency} t={t} />}

        {tab === "workflow" && (
          <div className="reg-cols">
            <div className="reg-stack">
              <dl className="kv">
                <dt>Trigger type</dt>
                <dd>{p.execution.triggerType ? TRIGGER_LABEL[p.execution.triggerType] : <NA />}</dd>
                <dt>Trigger</dt>
                <dd>{orNA(p.execution.trigger)}</dd>
                <dt>Schedule</dt>
                <dd>{orNA(p.execution.schedule, p.execution.triggerType === "scheduled" ? "documented" : "set")}</dd>
                <dt>Environment</dt>
                <dd>{orNA(p.execution.environment)}</dd>
              </dl>
              <div className="reg-field">
                <div className="section-title">Processing stages</div>
                {p.execution.stages.length ? (
                  <ol className="stages">
                    {p.execution.stages.map((s) => (
                      <li key={s}>{s}</li>
                    ))}
                  </ol>
                ) : (
                  <NA />
                )}
              </div>
            </div>
            <div className="reg-stack">
              <ListField title="Inputs" items={p.responsibilities.inputs} />
              <ListField title="Outputs" items={p.responsibilities.outputs} />
              <ListField title="Connected tools" items={p.responsibilities.tools} />
              <div className="reg-field">
                <div className="section-title">Dependencies</div>
                {p.responsibilities.dependencies.length ? (
                  <div className="chips">
                    {p.responsibilities.dependencies.map((d) => {
                      const dep = catalog.agents.find((a) => a.id === d);
                      return dep ? (
                        <button key={d} className="chip" onClick={() => select({ kind: "agent", id: d })}>
                          {dep.name}
                        </button>
                      ) : (
                        <span key={d} className="chip">
                          {d}
                        </span>
                      );
                    })}
                  </div>
                ) : (
                  <NA />
                )}
              </div>
              <ListField title="Operational limitations" items={p.responsibilities.limitations} />
            </div>
          </div>
        )}

        {tab === "operations" && <OperationsTab entry={entry} flags={flags.map((f) => ({ id: f.id, severity: f.severity, detail: f.detail }))} history={agent.history} manifestLastRun={agent.lastRun} />}

        {tab === "governance" && (
          <div className="reg-cols">
            <dl className="kv">
              <dt>Autonomy</dt>
              <dd>
                <AutonomyMeter level={p.governance.autonomy} />
                {p.governance.autonomyNote && <div className="muted small">{p.governance.autonomyNote}</div>}
              </dd>
              <dt>Risk</dt>
              <dd>
                <RiskPill risk={p.governance.risk} />
              </dd>
              <dt>Data sensitivity</dt>
              <dd>{p.governance.dataSensitivity ? cap(p.governance.dataSensitivity) : <NA />}</dd>
              <dt>Approval</dt>
              <dd>{orNA(p.governance.approval)}</dd>
              <dt>Credential owner</dt>
              <dd>{orNA(p.governance.credentialOwner)}</dd>
              <dt>Audit log</dt>
              <dd>{orNA(p.governance.auditLog)}</dd>
            </dl>
            <div className="reg-stack">
              <ListField title="Tool permissions" items={p.governance.permissions} />
              <ListField title="Declared capabilities" items={p.governance.capabilities} />
              <div className="na-block">
                <strong>Autonomy describes the agent, not Atlas.</strong>
                <span>
                  Levels: {([0, 1, 2, 3, 4] as const).map((l) => `${l} ${AUTONOMY_INFO[l].label}`).join(" · ")}. Atlas itself stays read-only and cannot start, approve or
                  change any agent.
                </span>
              </div>
            </div>
          </div>
        )}

        {tab === "docs" && (
          <div className="reg-cols">
            <div className="reg-stack">
              <dl className="kv">
                <dt>Repository</dt>
                <dd>
                  <ExternalLink href={p.repositoryUrl}>{p.repository}</ExternalLink>
                </dd>
                <dt>Source</dt>
                <dd className="mono">{p.docs.source ? <ExternalLink href={sourceUrl(p.docs.source)}>{p.docs.source}</ExternalLink> : <NA />}</dd>
                <dt>Technical notes</dt>
                <dd className="mono">{p.docs.technical ? <DocLink href={p.docs.technical} url={sourceUrl} /> : <NA />}</dd>
                <dt>Runbook</dt>
                <dd className="mono">{p.docs.runbook ? <DocLink href={p.docs.runbook} url={sourceUrl} /> : <NA />}</dd>
                <dt>Last review</dt>
                <dd>{p.docs.lastReview ? formatDate(p.docs.lastReview) : <NA />}</dd>
                <dt>Manifest</dt>
                <dd>atlas/{p.schema}</dd>
              </dl>
              <ListField title="Known issues" items={p.docs.knownIssues} />
              <ListField title="Improvement opportunities" items={p.docs.improvements} />
            </div>
            <div className="reg-field">
              <div className="section-title">
                Profile completeness · {entry.docs.done} of {entry.docs.total}
              </div>
              <ul className="doc-checks">
                {documentationChecks(p).map((c) => (
                  <li key={c.key} className={c.ok ? "ok" : "gap"}>
                    <Icon name={c.ok ? "check" : "circle"} size={12} /> {c.label}
                    {!c.ok && <span className="muted small"> · documentation gap</span>}
                  </li>
                ))}
              </ul>
              <p className="muted small">Fill gaps in this agent's registry block in catalog/*.yaml. The format is in catalog/README.md.</p>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

function DocLink({ href, url }: { href: string; url: (p: string) => string }) {
  return /^https:\/\//.test(href) ? <ExternalLink href={href}>{href}</ExternalLink> : <ExternalLink href={url(href)}>{href}</ExternalLink>;
}

const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

function GoalsTab({ kpis, objective, review, t }: { kpis: Kpi[]; objective: string | null; review: string | null; t: Telemetry }) {
  return (
    <>
      <dl className="kv" style={{ marginBottom: 16 }}>
        <dt>Primary objective</dt>
        <dd>{orNA(objective)}</dd>
        <dt>Review frequency</dt>
        <dd>{orNA(review)}</dd>
      </dl>
      {kpis.length === 0 ? (
        <div className="na-block">
          <strong>No KPIs defined.</strong>
          <span>Targets are set by people in the manifest; Atlas only fills observed values from connected telemetry.</span>
        </div>
      ) : (
        <KpiTable kpis={kpis} t={t} />
      )}
    </>
  );
}

export function KpiTable({ kpis, t }: { kpis: Kpi[]; t: Telemetry }) {
  const trend = successTrend(t);
  return (
    <table className="table runs-table">
      <thead>
        <tr>
          <th>KPI</th>
          <th>Target</th>
          <th>Observed</th>
          <th>Last measurement</th>
        </tr>
      </thead>
      <tbody>
        {kpis.map((k) => {
          const o = observeKpi(k, t);
          const met = meetsTarget(k, o?.value ?? null);
          return (
            <tr key={k.name}>
              <td>
                {k.name}
                <div className="muted small">
                  {cap(k.kind)}
                  {k.basis ? ` · ${k.basis}` : ""}
                </div>
              </td>
              <td>{k.target ?? <NA kind="set" />}</td>
              <td>
                {o ? (
                  <>
                    <span className={met === null ? "" : met ? "kpi-met" : "kpi-missed"}>{o.display}</span>
                    <div className="muted small">
                      from {o.samples} sample{o.samples === 1 ? "" : "s"}
                      {k.measure === "run_success_rate" && trend ? ` · trend ${trend}` : ""}
                    </div>
                  </>
                ) : k.measure ? (
                  <NA kind={t.source ? "verified" : "connected"} />
                ) : (
                  <NA kind="connected" />
                )}
              </td>
              <td className="small nowrap">{o && t.lastAnyRun ? relative(t.lastAnyRun.at) : <NA kind={t.source ? "verified" : "connected"} />}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function OperationsTab({
  entry,
  flags,
  history,
  manifestLastRun,
}: {
  entry: RegistryEntry;
  flags: { id: string; severity: string; detail: string }[];
  history: { at: string; event: string }[];
  manifestLastRun: string | null;
}) {
  const t = entry.telemetry;
  return (
    <>
      <div className="mon-grid">
        <Mon label="Status" value={OPERATIONAL_LABEL[entry.operational]} sub={t.source ? `Source: ${SOURCE_LABEL[t.source]}` : "No live source connected"} health={entry.operational === "verified" ? "good" : entry.operational === "failing" ? "bad" : "unknown"} />
        <Mon
          label="Reliability"
          value={t.successRate === null ? "Not verified" : `${Math.round(t.successRate * 100)}% succeeded`}
          sub={`${mainline(t.executions).length} counted run${mainline(t.executions).length === 1 ? "" : "s"} · ${t.failures} failed`}
          health={t.successRate === null ? "unknown" : t.successRate >= 0.9 ? "good" : t.successRate >= 0.6 ? "warn" : "bad"}
        />
        <Mon
          label="Usage and cost"
          value={t.monthSpendUsd !== null ? `$${t.monthSpendUsd.toFixed(2)} this month` : "Not connected"}
          sub={t.monthBudgetUsd !== null ? `Budget $${t.monthBudgetUsd.toFixed(2)} a month` : entry.profile.cost.budget ?? "No usage telemetry for this agent"}
          health={t.monthSpendUsd === null ? "unknown" : t.monthBudgetUsd && t.monthSpendUsd > t.monthBudgetUsd ? "bad" : "good"}
        />
      </div>

      <div className="section-title" style={{ marginTop: 18 }}>
        Execution history
      </div>
      {t.executions.length ? (
        <table className="table runs-table">
          <thead>
            <tr>
              <th>Result</th>
              <th>Run</th>
              <th>Duration</th>
              <th>When</th>
            </tr>
          </thead>
          <tbody>
            {t.executions.slice(0, 20).map((r) => (
              <tr key={`${r.at}:${r.label}`}>
                <td>
                  <span className={`result r-${r.result}`}>{r.result === "success" ? "Succeeded" : r.result === "failure" ? "Failed" : r.result === "running" ? "Running" : "Other"}</span>
                </td>
                <td>
                  {r.url ? <ExternalLink href={r.url}>{r.label}</ExternalLink> : r.label}
                  {r.offMainline && <div className="muted small">Pull request branch, not counted in the status</div>}
                </td>
                <td className="small">{r.durationMs != null ? `${(r.durationMs / 1000).toFixed(0)} s` : "–"}</td>
                <td className="small nowrap" title={new Date(r.at).toLocaleString()}>
                  {relative(r.at)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="na-block">
          <strong>{t.source ? "No executions observed yet." : "Execution history is not connected."}</strong>
          <span>
            {t.source === "github"
              ? "GitHub has not returned runs for this workflow. Refresh, or add a token if the repository is private."
              : t.source === "atlas-intel"
                ? "Runs appear here once the agent has run in this app."
                : "Atlas has no live source for this agent, so it cannot confirm that it has ever run. A configuration is not evidence of a successful execution."}
          </span>
        </div>
      )}

      {(history.length > 0 || manifestLastRun) && (
        <div style={{ marginTop: 18 }}>
          <div className="section-title">Recorded by hand in the manifest (not verified)</div>
          <ul className="timeline">
            {manifestLastRun && (
              <li className="k-agent">
                <div className="small">Last run, as written in the manifest</div>
                <div className="muted small">{formatDate(manifestLastRun)}</div>
              </li>
            )}
            {history.map((h) => (
              <li key={`${h.at}:${h.event}`} className="k-agent">
                <div className="small">{h.event}</div>
                <div className="muted small">{formatDate(h.at)}</div>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="section-title" style={{ marginTop: 18 }}>
        Errors and checks
      </div>
      {flags.length === 0 && entry.review.length === 0 ? (
        <div className="muted small">Nothing flagged for this agent.</div>
      ) : (
        <ul className="list" style={{ padding: 0 }}>
          {flags.map((f) => (
            <li key={f.id} className="list-row">
              <span className={`sev ${f.severity}`} aria-label={`${f.severity} severity`} />
              <span className="grow">
                <div className="title">{f.detail}</div>
              </span>
            </li>
          ))}
          {entry.review.map((r) => (
            <li key={r} className="list-row">
              <span className="sev medium" aria-label="Needs review" />
              <span className="grow">
                <div className="title">{r}</div>
              </span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function Mon({ label, value, sub, health }: { label: string; value: string; sub: string; health: "good" | "warn" | "bad" | "unknown" }) {
  return (
    <div className="mon">
      <div className="eyebrow">{label}</div>
      <div className="v">
        <i className={`h-${health}`} /> {value}
      </div>
      <div className="muted small">{sub}</div>
    </div>
  );
}
