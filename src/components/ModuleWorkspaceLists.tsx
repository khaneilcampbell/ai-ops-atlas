import { useMemo } from "react";
import { useAtlas } from "../state";
import { buildConnections } from "../lib/connections";
import { relative } from "../lib/time";
import { useLiveStatus } from "../live/feed";
import { workspaceBuildings } from "../modules/instances";
import { datasetInventory, moduleInventory, projectDependencies, workflowMap, type DependencyLink } from "../modules/inventory";
import type { AtlasModuleType } from "../modules/types";

const has = (type: AtlasModuleType, id: string) => type.capabilities.some((c) => c.id === id && c.state === "available");

/**
 * The workspace-wide lists a module's available capabilities promise: the module inventory in the
 * Command Center, declared project dependencies in the Repository Hub, the workflow map in the
 * Automation Plant and the dataset inventory in Data Intelligence. Closed by default so the panel
 * stays short; every row comes from a manifest line or an observed sync.
 */
export function ModuleWorkspaceLists({ type }: { type: AtlasModuleType }) {
  switch (type.id) {
    case "atlas-command-center": return has(type, "inventory") ? <Inventory /> : null;
    case "development-repository-hub": return has(type, "dependencies") ? <Dependencies /> : null;
    case "workflow-automation-plant": return has(type, "dependencies") ? <WorkflowMap /> : null;
    case "data-intelligence-center": return has(type, "datasets") ? <Datasets /> : null;
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
