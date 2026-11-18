import { useMemo } from "react";
import { defaultFloor, occupiedFloors, type BuildingDefinition } from "../buildings/buildingDefinition";
import { deskScreen, SCREEN_LABEL, type DeskScreen } from "../buildings/deskScreen";
import { insideShown, mapBuildings, openFloor, pickFloor, useInsideFloors } from "../buildings/insideFloors";
import type { IdentityStatus } from "../registry/agentStatus";
import { identityFor } from "../registry/identity";
import { RUN_LABEL } from "../routine/operations";
import { useRoutineOps, useWhere } from "../routine/useRoutineOps";
import { useAtlas } from "../state";
import { leaveInside, viewOffice } from "../views/map3d/agentFollow";
import { AgentIdentityLine } from "./AgentIdentity";

/**
 * A building's people, from its shared definition (buildings/buildingDefinition.ts): who works on
 * which floor, what each one's real work is doing (the same operational state as the agent's card
 * and its desk monitor), and where its character is in the city now. Lists every agent and run in
 * text alongside the 3D view, with View inside, a floor picker, Locate agent and Back to city.
 */
const SCREEN_STATUS: Record<DeskScreen, IdentityStatus> = {
  running: "working",
  waiting_approval: "waiting",
  failed: "failed",
  cancelled: "cancelled",
  succeeded: "completed",
  queued: "queued",
  neutral: "ready",
};

export function BuildingInside({ projectId }: { projectId: string }) {
  useInsideFloors();
  const def = [...mapBuildings().values()].find((d) => d.projectId === projectId);
  if (!def || !def.desks.length) return null;
  return <Inside def={def} />;
}

function Inside({ def }: { def: BuildingDefinition }) {
  const { catalog } = useAtlas();
  const ids = useMemo(() => def.desks.map((d) => d.agentId), [def]);
  const { ops, source } = useRoutineOps(ids);
  const shown = insideShown();
  const floors = occupiedFloors(def);
  const open = openFloor(def.id, defaultFloor(def));
  const active = def.desks.flatMap((d) => ops.get(d.agentId)?.open ?? []);
  const running = active.filter((r) => r.status === "running").length;
  const floorText = floors.length === 1 ? `floor ${floors[0]}` : `floors ${[...floors].reverse().join(", ")}`;
  return (
    <section className="building-inside" aria-label={`Inside ${def.name}`}>
      <div className="section-head">
        <div className="section-title">Inside</div>
        <span className="source">{source === "none" ? "No live run data" : source === "saved" ? "Last saved run data" : "Live run data"}</span>
      </div>
      <p className="small" style={{ margin: "0 0 8px" }}>
        {def.desks.length} {def.desks.length === 1 ? "agent" : "agents"} on {floorText} · {active.length === 0 ? "no runs in progress" : `${running} running${active.length > running ? `, ${active.length - running} waiting or queued` : ""}`}
      </p>
      <div className="building-inside-actions">
        {shown ? (
          <button className="ghost-btn" onClick={leaveInside}>
            Back to city
          </button>
        ) : (
          <button className="ghost-btn" onClick={() => viewOffice({ projectId: def.projectId, towerKey: def.id, floor: open })}>
            View inside
          </button>
        )}
        {floors.length > 1 && (
          <div className="building-floors" role="group" aria-label="Open floor">
            {floors.map((n) => (
              <button
                key={n}
                aria-pressed={shown && open === n}
                onClick={() => {
                  pickFloor(def.id, n);
                  if (!shown) viewOffice({ projectId: def.projectId, towerKey: def.id, floor: n });
                }}
              >
                Floor {n}
              </button>
            ))}
          </div>
        )}
      </div>
      {floors.map((n) => (
        <div key={n} className="building-floor">
          <div className="eyebrow">Floor {n}</div>
          <ul className="building-people">
            {def.desks
              .filter((d) => d.floor === n)
              .map((d) => (
                <Person key={d.id} def={def} agentId={d.agentId} floor={n} screen={deskScreen(ops.get(d.agentId))} runs={(ops.get(d.agentId)?.open ?? []).map((r) => `${RUN_LABEL[r.status]} · ${r.workflowName}`)} workflows={d.workflows.map((w) => catalog.agents.find((a) => a.id === w)?.name ?? w)} />
              ))}
          </ul>
        </div>
      ))}
    </section>
  );
}

function Person({ def, agentId, floor, screen, runs, workflows }: { def: BuildingDefinition; agentId: string; floor: number; screen: DeskScreen; runs: string[]; workflows: string[] }) {
  const { catalog } = useAtlas();
  const identity = identityFor(agentId, catalog.agents);
  const where = useWhere(agentId);
  return (
    <li>
      <AgentIdentityLine identity={identity} status={SCREEN_STATUS[screen]} size={28} showRole={false} />
      <div className="small">
        <span>Work: {SCREEN_LABEL[screen]}</span>
        <span className="muted"> · Now: {where ? `${where.activity}, ${where.place}` : "Not on the map yet"}</span>
      </div>
      {runs.length > 0 && <div className="small muted">{runs.join(" · ")}</div>}
      {workflows.length > 0 && <div className="small muted">Runs {workflows.join(", ")}</div>}
      <button className="text-btn" onClick={() => viewOffice({ projectId: def.projectId, towerKey: def.id, personaId: agentId, floor })} aria-label={`Locate ${identity.name}`}>
        Locate agent
      </button>
    </li>
  );
}
