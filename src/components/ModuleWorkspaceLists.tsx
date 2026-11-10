import { useMemo } from "react";
import { useAtlas } from "../state";
import { buildConnections } from "../lib/connections";
import { relative } from "../lib/time";
import { useLiveStatus } from "../live/feed";
import { workspaceBuildings } from "../modules/instances";
import { datasetInventory, moduleInventory, projectDependencies, workflowMap, type DependencyLink } from "../modules/inventory";
import type { AtlasModuleType } from "../modules/types";
import { n8nHealth, n8nWorkflowId, useN8nRuns } from "../n8n/runs";
import { feedNote, repoSecurity, repoTotals, securityRepos, severityText, useSecurityAlerts } from "../security/alerts";
import { ALERT_KINDS, ALERT_LABEL } from "../security/types";

const has = (type: AtlasModuleType, id: string) => type.capabilities.some((c) => c.id === id && c.state === "available");

/**
 * The workspace-wide lists a module's available capabilities promise: the module inventory in the
 * Command Center, declared project dependencies in the Repository Hub, the workflow map in the
 * Automation Plant (with live n8n runs), the dataset inventory in Data Intelligence and open GitHub
 * security alerts in the Security Operations Center. Closed by default so the panel
 * stays short; every row comes from a manifest line or an observed sync.
 */
export function ModuleWorkspaceLists({ type }: { type: AtlasModuleType }) {
  switch (type.id) {
    case "atlas-command-center": return has(type, "inventory") ? <Inventory /> : null;
    case "development-repository-hub": return has(type, "dependencies") ? <Dependencies /> : null;
    case "workflow-automation-plant": return <>{has(type, "n8n") && <N8nRuns />}{has(type, "dependencies") && <WorkflowMap />}</>;
    case "data-intelligence-center": return has(type, "datasets") ? <Datasets /> : null;
    case "security-operations-center": return has(type, "scanning") ? <SecurityAlerts /> : null;
    default: return null;
  }
}

function Inventory() {
  const { catalog } = useAtlas();
  const rows = useMemo(() => moduleInventory(workspaceBuildings(catalog)), [catalog]);
  const housed = rows.filter((r) => r.buildings.length).length;
  return (
    <details className="module-list" aria-label="Module inventory">
      <summary className="muted small">Module inventory · {rows.length} modules, {housed} with a building</summary>
      <ul>
        {rows.map((r) => (
          <li key={r.type}>
            <span>{r.name}</span>
            <span className="muted small">{r.buildings.join(", ") || "No building"} · {r.available} of {r.total} built</span>
          </li>
        ))}
      </ul>
    </details>
  );
}

function useConnections() {
  const { catalog, repos } = useAtlas();
  return { catalog, connections: useMemo(() => buildConnections(catalog, repos), [catalog, repos]) };
}

function Links({ links }: { links: DependencyLink[] }) {
  return (
    <ul>
      {links.map((l) => (
        <li key={l.id} title={l.evidence}>
          <span>{l.relation}</span>
          {l.failing && <span className="run-failure">Failing</span>}
        </li>
      ))}
    </ul>
  );
}

function Dependencies() {
  const { catalog, connections } = useConnections();
  const groups = useMemo(() => projectDependencies(connections, catalog), [connections, catalog]);
  const total = new Set(groups.flatMap((g) => g.links.map((l) => l.id))).size;
  return (
    <details className="module-list" aria-label="Project dependencies">
      <summary className="muted small">Project dependencies · {total} declared across {groups.length} projects</summary>
      {groups.length ? groups.map((g) => (
        <div key={g.projectId}>
          <div className="small">{g.name}</div>
          <Links links={g.links} />
        </div>
      )) : <p className="muted small">No dependencies declared in the manifests yet</p>}
      <p className="muted small">From the dependencies and connections each manifest declares.</p>
    </details>
  );
}

function WorkflowMap() {
  const { catalog, connections } = useConnections();
  const links = useMemo(() => workflowMap(connections, catalog), [connections, catalog]);
  return (
    <details className="module-list" aria-label="Workflow map">
      <summary className="muted small">Workflow map · {links.length} declared {links.length === 1 ? "link" : "links"}</summary>
      {links.length ? <Links links={links} /> : <p className="muted small">No automation declares a dependency yet</p>}
      <p className="muted small">Links an automation's manifest declares. A link is marked failing only when a run on it failed.</p>
    </details>
  );
}

function Datasets() {
  const { catalog, repos } = useAtlas();
  const live = useLiveStatus();
  const rows = datasetInventory(catalog, repos, live);
  return (
    <details className="module-list" aria-label="Dataset inventory">
      <summary className="muted small">Dataset inventory · {rows.filter((r) => r.state !== "none").length} of {rows.length} holding data</summary>
      <ul>
        {rows.map((r) => (
          <li key={r.id} data-state={r.state}>
            <span>{r.name}</span>
            <span className="muted small">{r.records} · {r.source}{r.updated ? ` · ${relative(r.updated)}` : ""}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}

const HEALTH_LABEL = { failing: "Last run failed", ok: "Last run succeeded", idle: "No recent run seen", off: "Switched off in n8n" } as const;

function N8nRuns() {
  const { catalog } = useAtlas();
  const n8n = useN8nRuns();
  const byWorkflow = useMemo(() => new Map(catalog.agents.flatMap((a) => { const id = n8nWorkflowId(a); return id ? [[id, a.name] as const] : []; })), [catalog]);
  const snap = n8n.value;
  const rows = snap?.state === "ok" ? snap.workflows : [];
  const failing = rows.filter((w) => n8nHealth(w) === "failing").length;
  const summary =
    snap?.state === "ok" ? `${rows.length} workflows, ${rows.filter((w) => w.active).length} on${failing ? `, ${failing} failing` : ""}`
    : snap?.state === "not-configured" ? "Not set up"
    : n8n.state === "loading" ? "Loading" : n8n.state === "error" ? "Unavailable" : "Not connected here";
  return (
    <details className="module-list" aria-label="Live n8n runs">
      <summary className="muted small">Live n8n runs · {summary}</summary>
      {snap?.state === "ok" ? (
        <>
          <ul>
            {rows.map((w) => {
              const health = n8nHealth(w);
              const last = w.runs[0];
              const linked = byWorkflow.get(w.id);
              return (
                <li key={w.id} data-state={health === "off" ? "none" : undefined}>
                  <span>{w.name}{linked && linked !== w.name ? <span className="muted small"> · {linked}</span> : null}</span>
                  <span className="muted small">
                    {health === "failing" ? <span className="run-failure">{HEALTH_LABEL[health]}</span> : HEALTH_LABEL[health]}
                    {last?.startedAt ? ` · ${relative(last.startedAt)}` : ""}
                    {w.failures24h ? ` · ${w.failures24h} failed in 24 h` : ""}
                  </span>
                </li>
              );
            })}
          </ul>
          <p className="muted small">Read from n8n {relative(snap.fetchedAt)}, covering its {snap.window} most recent runs. A workflow with no run in that window shows as not seen, never as healthy.</p>
        </>
      ) : (
        <p className="muted small">
          {snap?.state === "not-configured" ? `Atlas needs ${snap.need.charAt(0).toLowerCase()}${snap.need.slice(1)}` : n8n.message ?? "Loading n8n runs"}
        </p>
      )}
    </details>
  );
}

const SECURITY_LABEL = { attention: "Open alerts", clear: "No open alerts", unknown: "Not fully read" } as const;

function SecurityAlerts() {
  const { catalog } = useAtlas();
  const repos = useMemo(() => securityRepos(catalog.projects.map((p) => p.repository)), [catalog]);
  const alerts = useSecurityAlerts(repos);
  const snap = alerts.value;
  const rows = snap?.state === "ok" ? snap.repos : [];
  const withAlerts = rows.filter((r) => repoSecurity(r) === "attention").length;
  const unread = rows.filter((r) => repoSecurity(r) === "unknown").length;
  const summary =
    snap?.state === "ok" ? `${rows.length} repositories, ${withAlerts} with open alerts${unread ? `, ${unread} not fully read` : ""}`
    : snap?.state === "not-configured" ? "Not set up"
    : alerts.state === "loading" ? "Loading" : alerts.state === "error" ? "Unavailable" : "Not connected here";
  return (
    <details className="module-list" aria-label="Security alerts">
      <summary className="muted small">Security alerts · {summary}</summary>
      {snap?.state === "ok" ? (
        <>
          <ul>
            {rows.map((r) => {
              const state = repoSecurity(r);
              const t = repoTotals(r);
              const sev = severityText(t.severity);
              return (
                <li key={r.repo} data-state={state === "unknown" ? "none" : undefined} title={ALERT_KINDS.map((k) => `${ALERT_LABEL[k]}: ${feedNote(r.feeds[k])}`).join(" · ")}>
                  <a href={`https://github.com/${r.repo}/security`} target="_blank" rel="noreferrer">{r.repo.split("/")[1]}</a>
                  <span className="muted small">
                    {state === "attention" ? <span className="run-failure">{t.open}{t.more ? "+" : ""} open</span> : SECURITY_LABEL[state]}
                    {sev ? ` · ${sev}` : ""}
                    {` · ${ALERT_KINDS.map((k) => `${ALERT_LABEL[k]} ${feedNote(r.feeds[k])}`).join(", ")}`}
                  </span>
                </li>
              );
            })}
          </ul>
          <p className="muted small">Counted from GitHub {relative(snap.fetchedAt)}. Only counts and severities are read, never alert details. A repository shows no open alerts only when all three feeds were read.</p>
        </>
      ) : (
        <p className="muted small">
          {snap?.state === "not-configured" ? `Atlas needs ${snap.need.charAt(0).toLowerCase()}${snap.need.slice(1)}` : alerts.message ?? "Loading security alerts"}
        </p>
      )}
    </details>
  );
}
