import { useEffect, useMemo, useState } from "react";
import { useAtlas } from "../state";
import { buildConnections } from "../lib/connections";
import { relative } from "../lib/time";
import { useLiveStatus } from "../live/feed";
import { workspaceBuildings } from "../modules/instances";
import { datasetInventory, moduleInventory, projectDependencies, workflowMap, type DependencyLink } from "../modules/inventory";
import type { AtlasModuleType } from "../modules/types";
import { n8nHealth, n8nWorkflowId, useN8nRuns } from "../n8n/runs";
import { useHostDeploys } from "../infra/deploys";
import { capStatus, SPEND_CAPS, type CapState } from "../finance/caps";
import { useIntel } from "../intel/state";
import { useUsageData } from "../usage/data";
import { compact, money, providerLabel } from "../usage/model";
import { costPerModel, modelInventory, WINDOW_DAYS } from "../models/lab";
import { HOSTS, hostStatus, recentDeploys, type HostHealth } from "../infra/hosts";
import { infraIncidents } from "../infra/incidents";
import { useAllPropertyData, usePropertyIncidents } from "../properties/state";
import type { DeployState } from "../properties/deploys";
import { feedNote, repoSecurity, repoTotals, securityRepos, severityText, useSecurityAlerts } from "../security/alerts";
import { ALERT_KINDS, ALERT_LABEL } from "../security/types";
import { buildRegistry } from "../registry/registry";
import { pipelineCounts, pipelineStages, type StageState } from "../commerce/pipeline";
import { growthSites, RESEARCH_AGENT, researchBriefs, siteTraffic, type TrafficState } from "../growth/studio";
import { useAgentReports } from "../reports/client";

const has = (type: AtlasModuleType, id: string) => type.capabilities.some((c) => c.id === id && c.state === "available");

/**
 * The workspace-wide lists a module's available capabilities promise: the module inventory in the
 * Command Center, declared project dependencies in the Repository Hub, the workflow map in the
 * Automation Plant (with live n8n runs), the dataset inventory in Data Intelligence, open GitHub
 * security alerts in the Security Operations Center, hosting and deploys in Infrastructure and
 * spend against caps in Finance.
 * Closed by default so the panel
 * stays short; every row comes from a manifest line or an observed sync.
 */
export function ModuleWorkspaceLists({ type }: { type: AtlasModuleType }) {
  switch (type.id) {
    case "atlas-command-center": return has(type, "inventory") ? <Inventory /> : null;
    case "development-repository-hub": return has(type, "dependencies") ? <Dependencies /> : null;
    case "workflow-automation-plant": return <>{has(type, "n8n") && <N8nRuns />}{has(type, "dependencies") && <WorkflowMap />}</>;
    case "data-intelligence-center": return has(type, "datasets") ? <Datasets /> : null;
    case "finance-analytics-tower": return has(type, "caps") ? <SpendCaps /> : null;
    case "infrastructure-control-tower": return <>{has(type, "incidents") && <InfraIncidents />}{has(type, "hosts") && <Hosting />}{has(type, "deploys") && <DeployOverview />}</>;
    case "security-operations-center": return has(type, "scanning") ? <SecurityAlerts /> : null;
    case "commerce-product-marketplace": return has(type, "pipeline") ? <PublishingPipeline /> : null;
    case "model-intelligence-lab": return <>{has(type, "models") && <ModelInventory />}{has(type, "cost") && <ModelCost />}</>;
    case "growth-marketing-studio": return <>{has(type, "audience") && <SiteTraffic />}{has(type, "research") && <ResearchBriefs />}</>;
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

const HOST_LABEL: Record<HostHealth, string> = { live: "Live", failing: "Last deploy failed", deploying: "Deploying", unknown: "No deploy seen" };
const DEPLOY_LABEL: Record<DeployState, string> = { success: "Deployed", failure: "Failed", in_progress: "Running", queued: "Queued", cancelled: "Cancelled" };
const short = (sha: string) => sha.slice(0, 7);

function Hosting() {
  const deploys = useHostDeploys();
  const rows = HOSTS.map((h) => ({ h, d: deploys.get(h.id), s: hostStatus(deploys.get(h.id)?.value ?? null) }));
  const failing = rows.filter((r) => r.s.health === "failing").length;
  const seen = rows.filter((r) => r.d?.state === "ready").length;
  return (
    <details className="module-list" aria-label="Hosting inventory">
      <summary className="muted small">Hosting inventory · {rows.length} hosts{seen < rows.length ? `, ${seen} checked` : ""}{failing ? `, ${failing} with a failed deploy` : ""}</summary>
      <ul>
        {rows.map(({ h, d, s }) => (
          <li key={h.id} data-state={s.health === "unknown" ? "none" : undefined}>
            <span>{h.name}<span className="muted small"> · {h.host}</span></span>
            <span className="muted small">
              {d?.state === "ready" ? (s.health === "failing" ? <span className="run-failure">{HOST_LABEL[s.health]}</span> : HOST_LABEL[s.health])
                : d?.state === "error" ? "Unavailable" : "Loading"}
              {s.live ? ` · serving ${short(s.live.sha)} from ${relative(s.live.finishedAt ?? s.live.at)}` : ""}
              {" · "}<a href={h.console.url} target="_blank" rel="noreferrer">{h.console.label}</a>
            </span>
          </li>
        ))}
      </ul>
      <p className="muted small">From each host's deploy checks on the newest commits of its repository. A host with no deploy seen shows as unknown, never as live.</p>
    </details>
  );
}

function DeployOverview() {
  const deploys = useHostDeploys();
  const list = useMemo(() => recentDeploys(new Map([...deploys].map(([id, d]) => [id, d.value]))), [deploys]);
  const failed = list.filter((d) => d.state === "failure").length;
  const loading = [...deploys.values()].every((d) => d.state !== "ready");
  return (
    <details className="module-list" aria-label="Deployment overview">
      <summary className="muted small">Deployment overview · {list.length ? `${list.length} recent${failed ? `, ${failed} failed` : ""}` : loading ? "Loading" : "None seen"}</summary>
      {list.length ? (
        <ul>
          {list.map((d) => (
            <li key={`${d.hostId}:${d.id}`}>
              <span>{d.hostName}<span className="muted small"> · {short(d.sha)}</span></span>
              <span className="muted small">
                {d.state === "failure" ? <span className="run-failure">{DEPLOY_LABEL[d.state]}</span> : DEPLOY_LABEL[d.state]} · {relative(d.at)}
                {d.url ? <> · <a href={d.url} target="_blank" rel="noreferrer">Log</a></> : null}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted small">{loading ? "Reading deploys from GitHub" : "No production deploys on the newest commits"}</p>
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

const CAP_LABEL: Record<CapState, string> = { ok: "Under the cap", near: "Nearly used", over: "Cap reached", unseen: "Spend not visible to Atlas" };

function SpendCaps() {
  const { setView } = useAtlas();
  const intel = useIntel();
  const usage = useUsageData({ push: false });
  const atlasBudget = intel.status?.config ? { month: intel.status.month_spent_usd, budget: intel.status.config.monthly_budget_usd } : null;
  const rows = useMemo(() => SPEND_CAPS.map((c) => capStatus(c, usage.records, atlasBudget)), [usage.records, atlasBudget?.month, atlasBudget?.budget]); // eslint-disable-line react-hooks/exhaustive-deps
  const flagged = rows.filter((r) => r.state === "near" || r.state === "over").length;
  return (
    <details className="module-list" aria-label="Spend against caps">
      <summary className="muted small">Spend against caps · {usage.firstLoad ? "Loading" : `${rows.length} caps${flagged ? `, ${flagged} nearly used or reached` : ""}`}</summary>
      <ul>
        {rows.map((r) => (
          <li key={r.cap.id} data-state={r.state === "unseen" ? "none" : undefined} title={r.cap.covers}>
            <span>{r.cap.label}{r.limitUsd !== null ? <span className="muted small"> · {money(r.limitUsd)} a month</span> : null}</span>
            <span className="muted small">
              {r.state === "near" || r.state === "over" ? <span className="run-failure">{CAP_LABEL[r.state]}</span> : r.state === "ok" && !r.exact ? "Seen so far" : r.state === "unseen" && r.cap.measure.kind === "atlas-budget" ? "Shown in the Mac app" : CAP_LABEL[r.state]}
              {r.spentUsd !== null ? ` · ${r.exact ? "" : "at least "}${money(r.spentUsd)} used this month` : r.cap.measure.kind === "none" ? ` · ${r.cap.measure.reason}` : ""}
              {" · "}
              {"view" in r.cap.where ? (
                <button className="text-btn small" onClick={() => setView("settings")}>{r.cap.where.label}</button>
              ) : (
                <a href={r.cap.where.url} target="_blank" rel="noreferrer">{r.cap.where.label}</a>
              )}
            </span>
          </li>
        ))}
      </ul>
      <p className="muted small">This calendar month, in UTC. Provider caps count only the calls Atlas logs, so they show a lower bound: the provider's page has the full figure. Subscription use (Claude and ChatGPT plans) isn't billed per call, so it doesn't count.</p>
    </details>
  );
}

function InfraIncidents() {
  const deploys = useHostDeploys();
  const websites = usePropertyIncidents().open;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);
  const list = useMemo(() => infraIncidents(websites, new Map([...deploys].map(([id, d]) => [id, d.value])), now), [websites, deploys, now]);
  const critical = list.filter((i) => i.severity === "critical").length;
  const checked = [...deploys.values()].some((d) => d.state === "ready");
  return (
    <details className="module-list" aria-label="Infrastructure incidents" open={list.length > 0}>
      <summary className="muted small">Incidents · {list.length ? `${list.length} open${critical ? `, ${critical} critical` : ""}` : checked ? "None open" : "Checking"}</summary>
      {list.length ? (
        <ul>
          {list.map((i) => (
            <li key={i.key}>
              <span>{i.severity === "critical" ? <span className="run-failure">{i.title}</span> : i.title}<span className="muted small"> · {i.hostName}</span></span>
              <span className="muted small">
                {i.detail} · since {relative(i.since)}
                {i.actions.map((a) => <span key={a.label}> · <a href={a.url} target="_blank" rel="noreferrer">{a.label}</a></span>)}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted small">{checked ? "No failed or stuck deploys, outages, or expiring certificates seen." : "Reading deploys and site checks."}</p>
      )}
      <p className="muted small">From observed data only: the newest finished deploy of each host, and each website's site checks. A check that couldn't run is not counted as an incident or as healthy. Dismissed website incidents stay hidden here too.</p>
    </details>
  );
}

const TRAFFIC_LABEL: Record<TrafficState, string> = { counted: "Counted", "not-proxied": "Not proxied", "not-set-up": "Not set up", unavailable: "Unavailable", loading: "Loading" };
const num = (n: number) => n.toLocaleString();

function SiteTraffic() {
  const all = useAllPropertyData();
  const rows = growthSites().map((p) => siteTraffic(p, all[p.id]?.site));
  const counted = rows.filter((r) => r.state === "counted");
  const views = counted.reduce((n, r) => n + (r.data?.visits24h ?? 0), 0);
  const summary = counted.length
    ? `${num(views)} page views in 24 h`
    : rows.every((r) => r.state === "loading") ? "Loading" : TRAFFIC_LABEL[rows[0]?.state ?? "loading"];
  return (
    <details className="module-list" aria-label="Site traffic">
      <summary className="muted small">Site traffic · {summary}</summary>
      <ul>
        {rows.map((r) => (
          <li key={r.site.id} data-state={r.state === "counted" ? undefined : "none"}>
            <a href={r.site.url} target="_blank" rel="noreferrer">{r.site.domain}</a>
            <span className="muted small">
              {r.state === "counted" && r.data
                ? `${r.data.visits24h !== null ? `${num(r.data.visits24h)} page views · ` : ""}${num(r.data.requests24h)} requests${r.data.threats24h ? ` · ${num(r.data.threats24h)} threats blocked` : ""}`
                : `${TRAFFIC_LABEL[r.state]}${r.note ? ` · ${r.note}` : ""}`}
              {r.checkedAt ? ` · checked ${relative(r.checkedAt)}` : ""}
            </span>
          </li>
        ))}
      </ul>
      <p className="muted small">The last 24 hours, as Cloudflare counted them in the site checks. Page views, not unique visitors: Cloudflare can't add those up across hours. A site Cloudflare can't count shows why, never a zero.</p>
    </details>
  );
}

function ResearchBriefs() {
  const { select } = useAtlas();
  const { state, message, reports } = useAgentReports(RESEARCH_AGENT);
  const briefs = useMemo(() => researchBriefs(reports), [reports]);
  const summary = briefs.length
    ? `${briefs.length} month${briefs.length === 1 ? "" : "s"}, latest ${briefs[0].month}`
    : state === "loading" ? "Loading" : state === "error" ? "Unavailable" : state === "off" ? "Not connected here" : "None yet";
  return (
    <details className="module-list" aria-label="Product research briefs">
      <summary className="muted small">Product research briefs · {summary}</summary>
      {briefs.length ? (
        <ul>
          {briefs.map((b) => (
            <li key={b.id} title={`Runners-up: ${b.runnersUp.join(", ")}`}>
              <span>{b.topIdea}<span className="muted small"> · {b.month}</span></span>
              <span className="muted small">
                {b.score.toFixed(2)} of 5 · {b.validated ? "Validated by real demand" : "Hypothesis"} · {relative(b.at)}
                {b.notionUrl ? <> · <a href={b.notionUrl} target="_blank" rel="noreferrer">Notion</a></> : null}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted small">{message ?? (state === "loading" ? "Reading briefs from the site" : "No briefs yet. The next monthly run will appear here.")}</p>
      )}
      <p className="muted small">
        Each month's top pick from the research agent's brief, with its own scorecard total. A pick stays a hypothesis until real signups, preorders or sales back it.{" "}
        <button className="text-btn small" onClick={() => select({ kind: "agent", id: RESEARCH_AGENT })}>Full reports</button>
      </p>
    </details>
  );
}

const STAGE_LABEL: Record<StageState, string> = { failing: "Failed", silent: "Silent", ok: "Healthy", "not-running": "Not running", unknown: "Unknown" };

function PublishingPipeline() {
  const { catalog, repos } = useAtlas();
  const { telemetry } = useIntel();
  const feedLive = useLiveStatus().state === "live";
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);
  const entries = useMemo(() => buildRegistry(catalog, repos, telemetry), [catalog, repos, telemetry]);
  const stages = useMemo(() => pipelineStages(catalog.projects, catalog.agents, entries, now, feedLive), [catalog, entries, now, feedLive]);
  const n = pipelineCounts(stages);
  const parts = [n.failing && `${n.failing} failing`, n.silent && `${n.silent} silent`, n.ok && `${n.ok} healthy`, n["not-running"] && `${n["not-running"]} not running`, n.unknown && `${n.unknown} unknown`].filter(Boolean);
  return (
    <details className="module-list" aria-label="Publishing pipeline" open={n.failing + n.silent > 0}>
      <summary className="muted small">Publishing pipeline · {stages.length ? parts.join(", ") : "No commerce agents"}</summary>
      {stages.length ? (
        <ul>
          {stages.map((s) => (
            <li key={s.agent.id} data-state={s.state === "not-running" ? "none" : undefined}>
              <span>{s.agent.name}</span>
              <span className="muted small">
                {s.state === "failing" || s.state === "silent" ? <span className="run-failure">{STAGE_LABEL[s.state]}</span> : STAGE_LABEL[s.state]}
                {s.last?.at ? ` · ${relative(s.last.at)}` : ""}
                {s.detail ? ` · ${s.detail}` : ""}
                {s.last?.url ? <> · <a href={s.last.url} target="_blank" rel="noreferrer">Open run</a></> : null}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted small">No project in the catalog uses this module yet.</p>
      )}
      <p className="muted small">Every agent of the commerce projects, from observed runs only. Agents with alert rules follow them, so a stage switched off on purpose shows as not running, not failed. A stage with no run seen shows as unknown, never as healthy.</p>
    </details>
  );
}

function ModelInventory() {
  const usage = useUsageData({ push: false });
  const rows = useMemo(() => modelInventory(usage.records), [usage.records]);
  return (
    <details className="module-list" aria-label="Model inventory">
      <summary className="muted small">Model inventory · {usage.firstLoad ? "Loading" : rows.length ? `${rows.length} model${rows.length === 1 ? "" : "s"} in ${WINDOW_DAYS} days` : "None seen"}</summary>
      {rows.length ? (
        <ul>
          {rows.map((r) => (
            <li key={r.model} title={r.agents.join(", ")}>
              <span>{r.model}<span className="muted small"> · {r.providers.map(providerLabel).join(", ")}</span></span>
              <span className="muted small">{compact(r.requests)} calls · {r.agents.length} agent{r.agents.length === 1 ? "" : "s"} · last {relative(r.last)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted small">{usage.firstLoad ? "Reading usage." : "No model calls recorded on this device in the last 30 days."}</p>
      )}
      <p className="muted small">Every model a recorded call used in the last {WINDOW_DAYS} days, from the same records as API Usage. Hover a row for the agents that call it.</p>
    </details>
  );
}

function ModelCost() {
  const { setView } = useAtlas();
  const usage = useUsageData({ push: false });
  const rows = useMemo(() => costPerModel(usage.records), [usage.records]);
  const total = rows.reduce((n, r) => n + r.costUsd, 0);
  return (
    <details className="module-list" aria-label="Cost per model">
      <summary className="muted small">Cost per model · {usage.firstLoad ? "Loading" : rows.length ? `${money(total)} known in ${WINDOW_DAYS} days` : "None seen"}</summary>
      {rows.length ? (
        <ul>
          {rows.map((r) => (
            <li key={r.model} data-state={r.costUsd === 0 && !r.unpriced ? "none" : undefined}>
              <span>{r.model}</span>
              <span className="muted small">
                {r.costUsd > 0 ? `${r.unpriced ? "at least " : ""}${money(r.costUsd)}${r.billedOnly ? " billed" : r.costUsd ? " estimated" : ""}` : r.plan ? "Covered by a plan" : "Cost unknown"}
                {r.perRequestUsd !== null ? ` · ${money(r.perRequestUsd)} a call` : ""}
                {r.unpriced ? ` · ${r.unpriced} call${r.unpriced === 1 ? "" : "s"} with no price set` : ""}
                {r.plan && r.costUsd > 0 ? ` · ${r.plan} on a plan` : ""}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted small">{usage.firstLoad ? "Reading usage." : "No model calls recorded on this device in the last 30 days."}</p>
      )}
      <p className="muted small">
        Estimated means reported tokens times the prices set in Atlas; billed is the provider's own figure. A model with no price set shows its cost as unknown, never $0.{" "}
        <button className="text-btn small" onClick={() => setView("usage")}>API Usage</button>
      </p>
    </details>
  );
}
