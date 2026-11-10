import { useAtlas } from "../state";
import { ciHealth, repoData, type Health } from "../lib/derive";
import { moduleAvailability, moduleType } from "../modules/catalog";
import { buildingForSelection } from "../modules/lookup";
import { PRODUCT_DISTRICT_LABEL, type ModuleAvailability, type ModuleView } from "../modules/types";
import { HealthBadge } from "./bits";

/** Labels match the app's navigation (App.tsx NAV). */
const VIEW_LABEL: Record<ModuleView, string> = {
  map: "Projects", agents: "Agents", automations: "Automations", repos: "Repositories", overview: "Mission",
  activity: "Activity", intel: "Intel", usage: "API Usage", settings: "Settings", grid: "Grid",
};

const AVAILABILITY_LABEL: Record<ModuleAvailability, string> = { available: "Available", partial: "Partly available", planned: "Planned · Not connected" };

const CONNECTOR_LABEL: Record<string, string> = {
  github: "GitHub", "agent-feed": "Agent reports feed", "live-feed": "Live updates", "atlas-intel": "Atlas Intel", "usage-sync": "API usage sync",
};

/**
 * The building's Atlas module, shown in the inspector for every building that houses one.
 * Health comes only from an observed signal (the project repository's GitHub CI); a landmark
 * building has no telemetry yet, so its health is shown as not verified rather than guessed.
 */
export function ModuleSection() {
  const { selection, catalog, repos, setView } = useAtlas();
  const building = buildingForSelection(selection, catalog);
  const type = moduleType(building?.moduleType);
  if (!building || !type) return null;
  const availability = moduleAvailability(type);
  const project = building.projectId ? catalog.projects.find((p) => p.id === building.projectId) : undefined;
  const ci = project ? ciHealth(repoData(repos[project.repository])) : null;
  const health: Health = ci?.health ?? "unknown";
  const available = type.capabilities.filter((c) => c.state === "available");
  const planned = type.capabilities.filter((c) => c.state === "planned");

  return (
    <section className="module-section" aria-label="Atlas module" data-module={type.id}>
      <div className="section-title">Atlas module</div>
      <div className="module-card">
        <div className="module-head">
          <strong>{type.name}</strong>
          <span className={`chip module-${availability}`}>{AVAILABILITY_LABEL[availability]}</span>
        </div>
        <p className="muted small">{type.description} {PRODUCT_DISTRICT_LABEL[type.productDistrict]} module.</p>
        <dl className="kv">
          <dt>Health</dt>
          <dd><HealthBadge health={health} /> <span className="muted small">{ci ? `GitHub CI on ${project!.repository}: ${ci.value}` : "No telemetry connected for this building yet"}</span></dd>
          <dt>Connected services</dt>
          <dd>{type.connectors.length ? type.connectors.map((c) => CONNECTOR_LABEL[c] ?? c).join(" · ") : "None connected"}</dd>
        </dl>
        {availability === "planned" ? (
          <p className="muted small">This module is planned. None of its capabilities are built yet, so nothing here is live.</p>
        ) : (
          <>
            {type.views.filter((v) => v !== "map").length > 0 && (
              <div className="chips">
                {type.views.filter((v) => v !== "map").map((v) => (
                  <button key={v} className="chip" onClick={() => setView(v)}>Open {VIEW_LABEL[v]} →</button>
                ))}
              </div>
            )}
            <ul className="module-caps">
              {available.map((c) => <li key={c.id}><i className="cap-on" aria-hidden />{c.label}</li>)}
            </ul>
          </>
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
