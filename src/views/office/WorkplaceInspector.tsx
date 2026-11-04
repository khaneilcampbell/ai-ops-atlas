import type {Agent} from '../../catalog/types';
import {AgentDetail} from '../../components/DetailPanel';
import {AGENCY_BUILDING,agencyRoom} from './agencyWorkplaces';
/** Reuses the actual agent inspector; seating does not change execution telemetry. */
export function WorkplaceInspector({agent,onClose}:{agent:Agent;onClose:()=>void}){
 return <aside className="mall-workspace-panel selectable" aria-label="Assigned agent inspector">
  <p className="small">Workspace assigned · {agent.workplace?.building==='Atlas Marketplace'?'Building workflow planned':agent.workplace?.building===AGENCY_BUILDING?'Runs in n8n · Configured, not verified':'Existing workflow configuration preserved'}</p>
  <p className="small">{agent.workplace?.building} · Floor {agent.workplace?.floor} · Room {agent.workplace?.building===AGENCY_BUILDING?agencyRoom(agent.workplace.room)?.name??agent.workplace.room:agent.workplace?.room}</p>
  <p className="small muted">Existing execution evidence is shown separately. Seating is a visual representation, not live work.</p>
  <AgentDetail key={agent.id} id={agent.id} onClose={onClose}/>
 </aside>;
}
