import { useMemo } from "react";
import { catalog as fullCatalog } from "../catalog";
import { districtLabel } from "../catalog/organization";
import { OFF_MAP_PROJECTS } from "../catalog/projects";
import { FACILITY_SCALE, FACILITY_STATUS_LABEL, facilityById, facilityStatus, projectFacilities, toolFacilities, type ToolFacility } from "../catalog/toolFacilities";
import type { Agent } from "../catalog/types";
import { save } from "../lib/storage";
import { relative } from "../lib/time";
import { statusBadge, type IntegrationState } from "../product/integrations";
import { useIntegrationProbe } from "../product/probe";
import { useAtlas } from "../state";
import { latestFacilityPlan } from "../views/map3d/toolFacilityPlan";

// The inspector for Tool Facilities (catalog/toolFacilities.ts). It reads only what Atlas already
// has: the catalog for who uses the tool, and the Integration Center for its status. Status is
// never stronger than the Integration Center's own check.

const allFacilities = () => toolFacilities(fullCatalog.projects, fullCatalog.agents, new Set(OFF_MAP_PROJECTS));

/** The facility behind a selection id, or undefined. */
export function useFacility(selectionId: string): ToolFacility | undefined {
  return useMemo(() => facilityById(allFacilities(), selectionId), [selectionId]);
}

function useIntegration(f: Pick<ToolFacility, "integrationId"> | undefined): { state?: IntegrationState; checking: boolean } {
  const { states, checking } = useIntegrationProbe();
  return { state: f?.integrationId ? states.find((s) => s.def.id === f.integrationId) : undefined, checking };
}

/** Where the map put a satellite: placed (and at what share of the standard size) or why not. */
function placementLine(f: ToolFacility): string {
  if (f.source === "tool-office") return "District tool office, placed with the district's layout";
  const plan = latestFacilityPlan();
  if (!plan) return "Shown on the map when Tool facilities are switched on";
  const placed = plan.placed.find((p) => p.facility.id === f.id);
  if (placed) return placed.fit < 1 ? `Beside its building at ${Math.round(placed.fit * FACILITY_SCALE * 100)}% of its size (room was tight)` : `Beside its building at ${FACILITY_SCALE * 100}% of its size`;
  const miss = plan.unplaced.find((u) => u.facility.id === f.id);
  return miss ? `Not placed: ${miss.reason}` : "Not on the map";
}

/** Integration status for a facility or tool office, in the Integration Center's own words. */
export function FacilityIntegration({ facility }: { facility: Pick<ToolFacility, "integrationId" | "vendor"> }) {
  const { state, checking } = useIntegration(facility);
  if (!facility.integrationId) return <><dt>Integration status</dt><dd><span className="health"><i className="h-unknown" /> Unknown</span> <span className="muted small">· {facility.vendor} has no Integration Center entry, so Atlas can't check it</span></dd></>;
  if (!state) return <><dt>Integration status</dt><dd>{checking ? "Checking…" : "Unknown"}</dd></>;
  const badge = statusBadge(state);
  return (
    <>
      <dt>Integration status</dt>
      <dd data-status={facilityStatus(state)}>
        <span className="health"><i className={badge.dot} /> {badge.label}</span> <span className="muted small">· {state.detail}</span>
      </dd>
      <dt>Last verified</dt>
      <dd>{state.verifiedAt ? relative(state.verifiedAt) : "Not verified by a real check yet"}</dd>
    </>
  );
}

const latestRun = (items: Agent[]) => items.map((a) => a.lastRun).filter((t): t is string => !!t).sort().pop() ?? null;

/** The panel body for a Tool Facility, under the inspector's shared header. */
export function FacilityBody({ facility: f }: { facility: ToolFacility }) {
  const { catalog, select, setView, setFilters, clearFilters } = useAtlas();
  const project = catalog.projects.find((p) => p.id === f.projectId);
  const byId = new Map(catalog.agents.map((a) => [a.id, a]));
  const agents = f.associatedAgentIds.map((id) => byId.get(id)).filter((a): a is Agent => !!a);
  const workflows = f.associatedWorkflowIds.map((id) => byId.get(id)).filter((a): a is Agent => !!a);
  const history = [...agents, ...workflows].flatMap((a) => (a.history ?? []).map((h) => ({ ...h, who: a }))).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 5);
  const last = latestRun([...agents, ...workflows]);
  const link = (a: Agent) => <li key={a.id}><button className="text-btn" onClick={() => select({ kind: "agent", id: a.id })}>{a.name} →</button><span className="muted small">{a.status}</span></li>;
  return (
    <div className="panel-body selectable" data-facility={f.id}>
      <dl className="kv">
        <dt>Tool</dt>
        <dd>{f.vendor}</dd>
        <dt>Parent building</dt>
        <dd>{project ? <button className="linklike" onClick={() => select({ kind: "project", id: project.id })}>{project.name}</button> : f.parentBuildingId}</dd>
        <dt>District</dt>
        <dd>{districtLabel(f.districtId as Parameters<typeof districtLabel>[0])}</dd>
        <FacilityIntegration facility={f} />
        <dt>Last activity</dt>
        <dd>{last ? `${relative(last)} · latest recorded run of the items below` : "No run recorded in the catalog"}</dd>
        <dt>On the map</dt>
        <dd>{placementLine(f)}</dd>
      </dl>
      <p className="muted small">The roof light follows this status: green only after a real check succeeds, grey when set but unverified or unknown, amber when degraded, red when disconnected. Nothing animates.</p>
      <section>
        <div className="section-title">Agents using it</div>
        {agents.length ? <ul className="link-list">{agents.map(link)}</ul> : <p className="muted small">No AI agent names it.</p>}
      </section>
      <section>
        <div className="section-title">Workflows and automations using it</div>
        {workflows.length ? <ul className="link-list">{workflows.map(link)}</ul> : <p className="muted small">No automation names it.</p>}
        {f.workflowLinks.length > 0 && (
          <ul className="link-list">
            {f.workflowLinks.map((l) => <li key={l.url}><a href={l.url} target="_blank" rel="noreferrer">{l.label} ↗</a><span className="muted small">{byId.get(l.agentId)?.name}</span></li>)}
          </ul>
        )}
      </section>
      {history.length > 0 && (
        <section>
          <div className="section-title">Recent execution history</div>
          <ul className="link-list">{history.map((h, i) => <li key={i}><span>{h.event}</span><span className="muted small">{h.who.name} · {relative(h.at)}</span></li>)}</ul>
        </section>
      )}
      <div className="chips">
        <button className="chip" onClick={() => { clearFilters(); setFilters({ project: f.projectId }); setView("agents"); }}>Open Agent Registry →</button>
        <button className="chip" onClick={() => setView("workflows")}>Open Workflow Intelligence →</button>
        <button className="chip" onClick={() => setView("tasks")}>View Related Tasks →</button>
        {f.integrationId && <button className="chip" onClick={() => { save("workspaceTab", "integrations"); setView("workspace"); }}>View Integration Details →</button>}
      </div>
    </div>
  );
}

/** A project building's own facilities, for its inspector: every tool its items use, placed or not. */
export function BuildingFacilities({ projectId }: { projectId: string }) {
  const { select } = useAtlas();
  const project = fullCatalog.projects.find((p) => p.id === projectId);
  const list = useMemo(() => (project ? projectFacilities(project, fullCatalog.agents, !OFF_MAP_PROJECTS.has(projectId)) : []), [project, projectId]);
  const { states } = useIntegrationProbe();
  if (!list.length) return null;
  return (
    <section aria-label="Tool facilities">
      <div className="section-title">Tool facilities</div>
      <ul className="link-list">
        {list.map((f) => {
          const st = facilityStatus(f.integrationId ? states.find((s) => s.def.id === f.integrationId) : undefined);
          return (
            <li key={f.id}>
              <button className="text-btn" onClick={() => select({ kind: "service", id: f.source === "satellite" ? `facility:${f.id}` : f.id })}>{f.name} →</button>
              <span className="muted small">{f.vendor} · {FACILITY_STATUS_LABEL[st]}{f.source === "satellite" ? ` · ${placementLine(f)}` : ""}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
