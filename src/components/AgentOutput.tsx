import { WorkflowOutput } from "./WorkflowOutput";
import type { Agent } from "../catalog/types";
import { useIntel } from "../intel/state";
import { repoData } from "../lib/derive";
import { formatDate, relative } from "../lib/time";
import { telemetryFor } from "../registry/telemetry";
import { useAtlas } from "../state";
import { ExternalLink } from "./bits";
import { RepositoryNotice } from "./RepositoryNotice";

const SOURCE = { github: "GitHub Actions", "atlas-intel": "Atlas intelligence", "agent-feed": "Agent activity feed", production: "Production reports", manual: "Manifest" };
const RESULT = { running: "Reported running", success: "Succeeded", failure: "Failed", other: "Other / skipped" };

/** Read existing evidence only. Opening this panel never starts an agent or a model call. */
export function AgentOutput({ agent }: { agent: Agent }) {
  const { repos, setView } = useAtlas();
  const intel = useIntel();
  const state = repos[agent.repository];
  const snap = repoData(state);
  const telemetry = telemetryFor(agent, snap, intel.telemetry?.runs ?? null, null, intel.telemetry?.agentRuns, intel.telemetry?.production);
  const latest = telemetry.lastAnyRun;
  const checkedAt = telemetry.source === "github" ? snap?.runsCheckedAt ?? snap?.fetchedAt : intel.telemetry?.observedAt;
  const stale = state?.kind === "error" || (state?.kind === "ok" && state.stale);
  return <>
    {telemetry.source === "github" && <WorkflowOutput key={agent.id} repo={agent.repository} runs={telemetry.executions} documentation={agent.id === "hub-ci"}/> }
    <section aria-label="Latest recorded work">
      <div className="section-title">Latest recorded work</div>
      <p>{latest ? RESULT[latest.result] : "No execution recorded"}</p>
      <p className="small">{latest?.label ?? "Atlas has no observed work for this agent yet. Its declared Active status does not mean it is executing."}</p>
      {latest && <p className="muted small">Reported {formatDate(latest.at)} · {relative(latest.at)}. This is the last observed state, not a live task transcript.</p>}
      <dl className="kv"><dt>Evidence source</dt><dd>{telemetry.source ? SOURCE[telemetry.source] : "No execution source connected"}</dd><dt>Last checked</dt><dd>{checkedAt ? `${formatDate(checkedAt)} (${relative(checkedAt)})` : "Not available"}</dd></dl>
      {stale && telemetry.source === "github" && <p className="notice">Cached evidence — the latest refresh is stale or unavailable.</p>}
      {state?.kind === "error" && agent.observe?.githubWorkflow && <RepositoryNotice message={state.message}/>}
      {latest?.url && <ExternalLink href={latest.url}>Open run, logs and artifacts on GitHub →</ExternalLink>}
    </section>
    <section aria-label="Recorded output">
      <div className="section-title">Output & results</div>
      <p className="muted small">Recorded executions appear below. Generated files and job results are listed above when a GitHub workflow is connected; full file contents and raw logs remain at their source. City animations do not indicate live work.</p>
      {agent.observe?.atlasIntel && <button className="text-btn" onClick={() => setView("intel")}>View saved intelligence reports →</button>}
      {telemetry.executions.length > 0 ? <ul className="timeline">{telemetry.executions.slice(0, 10).map((item, index) => <li key={`${item.at}:${index}`}>
        <strong className="small">{RESULT[item.result]}{item.offMainline ? " · Other branch" : ""}</strong>
        <div className="small">{item.label}</div>
        <div className="muted small">{formatDate(item.at)} · {SOURCE[item.source]}</div>
        {item.url && <ExternalLink href={item.url}>Inspect result →</ExternalLink>}
      </li>)}</ul> : <p className="small">No output is available yet. Connect the agent’s execution source or wait for its next scheduled or manually requested run.</p>}
    </section>
  </>;
}
