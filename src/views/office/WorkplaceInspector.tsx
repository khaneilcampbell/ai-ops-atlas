import type {Agent} from '../../catalog/types';
import {AgentDetail} from '../../components/DetailPanel';
/** Reuses the actual agent inspector; seating does not change execution telemetry. */
export function WorkplaceInspector({agent,onClose}:{agent:Agent;onClose:()=>void}){
 return <aside className="mall-workspace-panel selectable" aria-label="Assigned agent inspector">
  <p className="small">Workspace assigned · {agent.workplace?.building==='Atlas Marketplace'?'Building workflow planned':'Existing workflow configuration preserved'}</p>
  <p className="small">{agent.workplace?.building} · Floor {agent.workplace?.floor} · Room {agent.workplace?.room}</p>
  <p className="small muted">Existing execution evidence is shown separately. Seating is a visual representation, not live work.</p>
  <AgentDetail key={agent.id} id={agent.id} onClose={onClose}/>
 </aside>;
}
