/** Local inspection only. Valid structure is not authenticated execution or approval evidence. */
export const READINESS_BYTES = 32_768;
const owners = ['atlas-production-coordinator', 'benjaire-product-lab-research', 'commerce-tests', 'atlas-production-coordinator'];
const domains = ['benjaire_hq', 'market_agency', 'atlas_marketplace', 'benjaire_hq'];
const kinds = ['objective.recorded', 'campaign.supplied', 'readiness.blocked', 'summary.prepared'];
export interface ReadinessPacket {
  revision: string; fixture: boolean; observed_at: string;
  state: 'awaiting approval'; readiness: 'blocked';
  events: {event_id: string; source_system: string; payload: {stage_owner: string}}[];
}
type J = Record<string, unknown>;
const object = (x: unknown): x is J => !!x && typeof x === 'object' && !Array.isArray(x);
const exact = (x: J, keys: string[]) => Object.keys(x).length === keys.length && keys.every(k => Object.prototype.hasOwnProperty.call(x, k));
const id = (x: unknown): x is string => typeof x === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(x);
const texts = (x: unknown) => Array.isArray(x) && x.length > 0 && x.length <= 10 && x.every(t => typeof t === 'string' && t.length > 0 && t.length <= 500);
export function parseReadiness(text: string): ReadinessPacket {
  if (new TextEncoder().encode(text).length > READINESS_BYTES) throw Error('Packet exceeds 32 KiB.');
  let x: unknown;
  try { x = JSON.parse(text); } catch { throw Error('Choose a valid JSON readiness packet.'); }
  if (!object(x) || !exact(x, ['revision','fixture','state','workflow','events','readiness','blockers','next_action','model_calls','publish_authorized','external_actions','atlas_delivery','observed_at']) ||
      typeof x.revision !== 'string' || !/^[a-f0-9]{64}$/.test(x.revision) || typeof x.fixture !== 'boolean' ||
      x.state !== 'awaiting approval' || x.readiness !== 'blocked' || x.workflow !== 'manual campaign readiness' ||
      x.model_calls !== 0 || x.publish_authorized !== false || x.external_actions !== false ||
      x.atlas_delivery !== 'not connected; local report only' || !texts(x.blockers) ||
      typeof x.next_action !== 'string' || x.next_action.length > 1000 ||
      typeof x.observed_at !== 'string' || !Number.isFinite(Date.parse(x.observed_at)) ||
      !Array.isArray(x.events) || x.events.length !== 4) throw Error('Unsupported readiness packet. No approval or execution is accepted here.');
  let objective: string | undefined;
  x.events.forEach((event: unknown, index: number) => {
    if (!object(event) || !exact(event, ['event_id','event_type','schema_version','timestamp','source_system','destination_system','correlation_id','causation_id','business_objective_id','entity_id','actor_type','approval_status','payload']) ||
        event.event_id !== `${x.revision}:${index}` || event.event_type !== kinds[index] || event.schema_version !== 1 ||
        event.timestamp !== x.observed_at || event.source_system !== domains[index] || event.destination_system !== (domains[index + 1] ?? 'atlas') ||
        !id(event.correlation_id) || event.business_objective_id !== event.correlation_id || event.entity_id !== event.correlation_id ||
        event.causation_id !== (index ? `${x.revision}:${index - 1}` : null) || event.actor_type !== 'local_runner' || event.approval_status !== 'pending' ||
        !object(event.payload) || !exact(event.payload, ['stage_owner','execution_source']) || event.payload.stage_owner !== owners[index] ||
        event.payload.execution_source !== 'supplied-input rehearsal' || (objective !== undefined && event.correlation_id !== objective)) throw Error('Invalid domain handoff or stage owner.');
    objective = event.correlation_id;
  });
  return x as unknown as ReadinessPacket;
}
