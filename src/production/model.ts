/** Compact production evidence. Payloads never contain prompts, outputs or customer data. */
export interface ProductionReport {
  agentId: string;
  eventId: string;
  kind: 'heartbeat' | 'run';
  runId?: string;
  status?: 'running' | 'success' | 'failure';
  durationMs?: number;
  costUsd?: number;
}
export interface ProductionEvent { id: number; at: string; body: ProductionReport }
export const STALE_MS = 15 * 60_000;
export function validReport(value: unknown): value is ProductionReport {
  if (!value || typeof value !== 'object') return false;
  const r = value as ProductionReport;
  const id = (x: unknown) => typeof x === 'string' && /^[a-zA-Z0-9_.:-]{1,128}$/.test(x);
  return id(r.agentId) && id(r.eventId) && (r.kind === 'heartbeat' || (r.kind === 'run' && id(r.runId) && ['running', 'success', 'failure'].includes(r.status ?? ''))) &&
    [r.durationMs, r.costUsd].every(x => x === undefined || (typeof x === 'number' && Number.isFinite(x) && x >= 0));
}
export function mergeProduction(events: ProductionEvent[], event: ProductionEvent): ProductionEvent[] {
  const key = (e: ProductionEvent) => `${e.body.agentId}:${e.body.kind}:${e.body.kind === 'run' ? e.body.runId : ''}`;
  const old = events.find(e => key(e) === key(event));
  if (old && (old.id >= event.id || (old.body.status !== 'running' && old.body.kind === 'run' && event.body.status === 'running'))) return events;
  return [...events.filter(e => key(e) !== key(event)), event].sort((a,b) => b.id-a.id).slice(0, 2000);
}
