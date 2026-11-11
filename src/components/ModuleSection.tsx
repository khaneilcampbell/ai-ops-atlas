import { useAtlas } from "../state";
import { relative } from "../lib/time";
import { moduleAvailability, moduleType } from "../modules/catalog";
import { buildingForSelection } from "../modules/lookup";
import { aggregateHealth, buildingAssets, executionHistory, observable } from "../modules/operations";
import { PRODUCT_DISTRICT_LABEL, type ModuleAvailability, type ModuleView } from "../modules/types";
import { integrationLabel } from "../modules/integrations";
import { WORKSPACE, isEntitled } from "../modules/workspace";
import { workspaceScope, workspaceViews } from "../modules/workspaces";
import { HealthBadge } from "./bits";
import { MODULE_HEALTH, ModuleWorkspaceLists } from "./ModuleWorkspaceLists";

/** Labels match the app's navigation (App.tsx NAV). */
const VIEW_LABEL: Record<ModuleView, string> = {
  map: "Projects", agents: "Agents", automations: "Automations", repos: "Repositories", overview: "Mission",
  activity: "Activity", intel: "Intel", usage: "API Usage", settings: "Settings", grid: "Grid",
};

const RESULT_LABEL = { success: "Succeeded", failure: "Failed", running: "Running", other: "Finished" } as const;

const AVAILABILITY_LABEL: Record<ModuleAvailability, string> = { available: "Available", partial: "Partly available", planned: "Planned · Not connected" };

/**
 * The building's Atlas module, shown in the inspector for every building that houses one.
 * Health comes only from an observed signal (the project repository's GitHub CI); a landmark
 * building has no telemetry yet, so its health is shown as not verified rather than guessed.
 */
export function ModuleSection() {
  const { selection, catalog, repos, setView, select, setFilters, clearFilters } = useAtlas();
  const building = buildingForSelection(selection, catalog);
  const type = moduleType(building?.moduleType);
  if (!building || !type) return null;
  const entitled = isEntitled(WORKSPACE, type.id);
  const availability = moduleAvailability(type);
  const assets = buildingAssets(building, catalog);
  const agg = aggregateHealth(assets.repositories, repos);
  const items = [...assets.agents, ...assets.automations];
  const runs = executionHistory(items, repos);
  const watched = observable(items);
  const available = type.capabilities.filter((c) => c.state === "available");
  const planned = type.capabilities.filter((c) => c.state === "planned");
  const views = workspaceViews(type);
  // A building with no repository has no CI to read; a module that reads its own live sources
  // reports those instead (only while entitled and built, so a planned module never reads live).
  const OwnHealth = !assets.repositories.length && entitled && availability !== "planned" ? MODULE_HEALTH[type.id] : undefined;
  // Open a workspace view on this building's own agents when the view can be scoped to them.
  const open = (v: ModuleView) => {
    const scope = workspaceScope(v, building.projectId);
    if (scope) {
      clearFilters();
      setFilters(scope);
    }
    setView(v);
  };

  return (
    <section className="module-section" aria-label="Atlas module" data-module={type.id}>
      <div className="section-title">Atlas module</div>
      <div className="module-card">
        <div className="module-head">
          <strong>{type.name}</strong>
          <span className={`chip module-${entitled ? availability : "planned"}`}>{entitled ? AVAILABILITY_LABEL[availability] : "Not included in this workspace"}</span>
        </div>
        <p className="muted small">{type.description} {PRODUCT_DISTRICT_LABEL[type.productDistrict]} module.</p>
        <dl className="kv">
          <dt>Health</dt>
          {OwnHealth ? <OwnHealth /> : <dd data-state={agg.state}><HealthBadge health={agg.health} /> <span className="muted small">{agg.summary}</span></dd>}
          <dt>Linked assets</dt>
          <dd>{assets.repositories.length || items.length ? [
            count(assets.projects.length, "project"), count(assets.repositories.length, "repository", "repositories"),
            count(assets.agents.length, "agent"), count(assets.automations.length, "automation"),
          ].filter(Boolean).join(" · ") : "None linked yet"}</dd>
          <dt>Connected services</dt>
          <dd>{type.connectors.length ? type.connectors.map((c) => integrationLabel(c)).join(" · ") : "None connected"}</dd>
        </dl>
        {!entitled ? (
          <p className="muted small">This workspace doesn't include this module, so its views are switched off here.</p>
        ) : availability === "planned" ? (
          <p className="muted small">This module is planned. None of its capabilities are built yet, so nothing here is live.</p>
        ) : (
          <>
            {views.length > 0 && (
              <div className="chips">
                {views.map((v) => (
                  <button key={v} className="chip" onClick={() => open(v)} title={workspaceScope(v, building.projectId) ? `${VIEW_LABEL[v]}, filtered to ${building.name}` : VIEW_LABEL[v]}>Open {VIEW_LABEL[v]} →</button>
                ))}
              </div>
            )}
            <ul className="module-caps">
              {available.map((c) => <li key={c.id}><i className="cap-on" aria-hidden />{c.label}</li>)}
            </ul>
            <ModuleWorkspaceLists type={type} />
          </>
        )}
        {items.length > 0 && (
          <div className="module-runs" aria-label="Recent executions">
            <div className="muted small">Recent executions{watched ? ` · GitHub Actions, ${watched} of ${items.length} watched` : ""}</div>
            {runs.length ? (
              <ul>
                {runs.map((r) => (
                  <li key={r.agentId}>
                    <button className="linklike" onClick={() => select({ kind: "agent", id: r.agentId })}>{r.name}</button>
                    <span className={`run-${r.result}`}>{RESULT_LABEL[r.result]}</span>
                    <a className="muted small" href={r.url} target="_blank" rel="noreferrer">{relative(r.at)}</a>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted small">{watched ? (agg.state === "loading" ? "Loading runs from GitHub…" : "No runs observed yet") : "None of these report runs to GitHub Actions; see each one's own panel"}</p>
            )}
          </div>
        )}
        {planned.length > 0 && (
          <details className="module-planned">
            <summary className="muted small">{planned.length} planned {planned.length === 1 ? "capability" : "capabilities"}, not built yet</summary>
            <ul className="module-caps">{planned.map((c) => <li key={c.id} className="muted"><i className="cap-off" aria-hidden />{c.label}</li>)}</ul>
          </details>
        )}
      </div>
    </section>
  );
}

function count(n: number, one: string, many = `${one}s`): string {
  return n ? `${n} ${n === 1 ? one : many}` : "";
}
