import { expect, it } from 'vitest';
import { mergeProduction, type ProductionEvent } from './model';
import { telemetryFor } from '../registry/telemetry';
import { runtimeFor } from '../views/office/model';
import type { Agent } from '../catalog/types';
it('keeps terminal results and separates production evidence from CI', () => {
  const at = '2026-10-28T12:00:00.000Z';
  const event: ProductionEvent = { id: 1, at, body: { agentId: 'prod', eventId: '1', kind: 'run', runId: 'a', status: 'failure' } };
  const events = mergeProduction([event], { ...event, id: 2, body: { ...event.body, status: 'running' } });
  expect(events).toEqual([event]);
  const agent = { id: 'prod', status: 'active', observe: { githubWorkflow: 'ci.yml' }, registry: { governance: { autonomy: 3 } } } as Agent;
  expect(telemetryFor(agent, undefined, null).source).toBe(null);
  const fresh = telemetryFor(agent, undefined, null, null, null, events, Date.parse(at));
  expect(runtimeFor(agent, fresh).state).toBe('failed');
  const stale = telemetryFor(agent, undefined, null, null, null, events, Date.parse(at) + 16 * 60_000);
  expect(runtimeFor(agent, stale).state).toBe('unknown');
});
