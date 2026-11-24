import { useEffect, useMemo, useState } from "react";
import { useAtlas } from "../state";
import { useRoutines } from "../routine/useRoutineOps";
import { insideShown, useInsideFloors } from "../buildings/insideFloors";
import { cafeNow, CAFE_PHASE_LABEL, useCafePlan } from "../views/map3d/cafeVisits";
import { CAFE_KEY } from "../views/map3d/cafePlan";
import { rosterAgents } from "../views/map3d/cityRoster";
import { selectCityAgent, setCityAgentsPanel } from "../views/map3d/cityAgentsStore";
import { leaveInside, setFollowedAgent, viewOffice } from "../views/map3d/agentFollow";
import { clock } from "../routine/routine";
import { useTimeZone } from "../lib/timezone";
import { AgentIdentityLine } from "./AgentIdentity";

/**
 * The Community Pavilion & Café's panel: what it is for, who is there now and which seats are free, all
 * from the same café visits the map draws (views/map3d/cafeVisits.ts), with View inside and the usual
 * agent actions (select in City agents, follow). Visits are city simulation only: there are no orders,
 * payments or messages behind them.
 */
export function CommunityCafePanel() {
  const { catalog } = useAtlas();
  useInsideFloors();
  const plan = useCafePlan();
  const tz = useTimeZone();
  const routines = useRoutines();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 5000);
    return () => window.clearInterval(id);
  }, []);
  const people = useMemo(() => new Map(rosterAgents(catalog.agents).map((r) => [r.identity.personaId, r.identity])), [catalog.agents]);
  const state = useMemo(() => (plan ? cafeNow(routines, plan, now) : null), [plan, routines, now]);
  const shown = insideShown();
  if (!plan || !state) return <p className="muted">The café appears on the 3D map in the District grouping. Open the map to see who is visiting.</p>;
  const free = state.free.indoor + state.free.terrace + state.free.bench;
  const total = state.total.indoor + state.total.terrace + state.total.bench;
  return (
    <>
      <p>A low pavilion on the square beside the Atlas Automation Plaza where Atlas's agents spend free time between runs: a stop at the counter, then a seat inside, on the pergola terrace or on a bench.</p>
      <div className="building-inside-actions">
        {shown ? (
          <button className="ghost-btn" onClick={leaveInside}>
            Back to city
          </button>
        ) : (
          <button className="ghost-btn" onClick={() => viewOffice({ projectId: null, towerKey: null, service: CAFE_KEY })}>
            View inside
          </button>
        )}
      </div>
      <dl className="kv">
        <dt>Visitors now</dt>
        <dd>{state.visitors.length === 0 ? "Nobody right now" : `${state.visitors.length} ${state.visitors.length === 1 ? "agent" : "agents"}`}{state.arriving.length ? ` · ${state.arriving.length} on the way` : ""}</dd>
        <dt>Seats free</dt>
        <dd>
          {free} of {total} · inside {state.free.indoor}/{state.total.indoor}, terrace {state.free.terrace}/{state.total.terrace}, benches {state.free.bench}/{state.total.bench}
        </dd>
      </dl>
      {state.visitors.length > 0 && (
        <section>
          <div className="section-title">At the café</div>
          <ul className="building-people">
            {state.visitors.map((v) => {
              const identity = people.get(v.personaId);
              return (
                <li key={v.personaId}>
                  {identity ? <AgentIdentityLine identity={identity} size={28} showRole={false} /> : <span>{v.personaId}</span>}
                  <div className="small">
                    {CAFE_PHASE_LABEL[v.phase]}
                    {v.phase === "seated" || v.phase === "to_seat" ? ` · ${v.where}` : ""}
                    <span className="muted"> · until about {clock(v.until, tz)}</span>
                  </div>
                  <div className="cafe-visitor-actions">
                    <button className="text-btn" onClick={() => { selectCityAgent(v.personaId); setCityAgentsPanel(true); }} aria-label={`Select ${identity?.name ?? v.personaId} in City agents`}>
                      Select agent
                    </button>
                    <button className="text-btn" onClick={() => setFollowedAgent(v.personaId)} aria-label={`Follow ${identity?.name ?? v.personaId}`}>
                      Follow
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}
      <p className="small muted">Visits are a picture of the agents' free time, worked out from their real schedules: each takes a free seat, never one already taken, and work calls it back to its desk at once. Nothing is ordered or paid for and no message is sent. Agents with nothing scheduled can be sent here from City agents, Free time, Café.</p>
    </>
  );
}
