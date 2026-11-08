import type {Agent} from '../../catalog/types';
import {AgentDetail} from '../../components/DetailPanel';
import {AGENCY_BUILDING,agencyRoom} from './agencyWorkplaces';
import {AgentReportSummary} from '../../components/AgentReports';
import {isReportAgent,type ReportAgent} from '../../reports/model';
import {PRODUCT_LAB_AGENT} from '../../reports/productLab';

/** Whose latest report a seat shows: its own, or in the Agency's Client review room the Product Lab brief. */
export function seatReport(agent:Agent):ReportAgent|null{
 if(isReportAgent(agent.id))return agent.id;
 return agent.workplace?.building===AGENCY_BUILDING&&agent.workplace.room==='1-review'?PRODUCT_LAB_AGENT:null;
}
/** Reuses the actual agent inspector; seating does not change execution telemetry. */
export function WorkplaceInspector({agent,onClose}:{agent:Agent;onClose:()=>void}){
 const report=seatReport(agent);
 return <aside className="mall-workspace-panel selectable" aria-label="Assigned agent inspector">
  <p className="small">Workspace assigned · {agent.workplace?.building==='Atlas Marketplace'?'Building workflow planned':agent.workplace?.building===AGENCY_BUILDING?'Runs in n8n · Configured, not verified':'Existing workflow configuration preserved'}</p>
  <p className="small">{agent.workplace?.building} · Floor {agent.workplace?.floor} · Room {agent.workplace?.building===AGENCY_BUILDING?agencyRoom(agent.workplace.room)?.name??agent.workplace.room:agent.workplace?.room}</p>
  <p className="small muted">Existing execution evidence is shown separately. Seating is a visual representation, not live work.</p>
  {report&&<section><div className="section-title">Latest {report===PRODUCT_LAB_AGENT?'Product Lab brief':'report'}</div><AgentReportSummary agent={report}/><p className="small muted">The full report is under Agents, in this agent's Report tab.</p></section>}
  <AgentDetail key={agent.id} id={agent.id} onClose={onClose}/>
 </aside>;
}
