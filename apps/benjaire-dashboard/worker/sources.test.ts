import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildTiles } from './overview.ts';
import { SOURCES, connectionStatus, type ConnectionStatus, type SourceKey } from './sources.ts';

const stripe = SOURCES.find((s) => s.key === 'stripe')!;
const env = { STRIPE_RESTRICTED_KEY: 'rk_live_x' };
const now = new Date('2026-10-18T12:00:00Z');
const run = (status: 'ok' | 'error', lastOkMinAgo: number | null) => ({
  source: 'stripe', status, started_at: now.toISOString(), finished_at: now.toISOString(),
  last_ok_at: lastOkMinAgo === null ? null : new Date(now.getTime() - lastOkMinAgo * 60_000).toISOString(),
});

test('missing credentials mean not connected, and name what is missing', () => {
  const s = connectionStatus(stripe, {}, undefined, now);
  assert.equal(s.state, 'not_connected');
  assert.deepEqual(s.missing, ['STRIPE_RESTRICTED_KEY']);
});

test('a credential alone is not healthy', () => {
  assert.equal(connectionStatus(stripe, env, undefined, now).state, 'awaiting_sync');
  assert.equal(connectionStatus(stripe, env, run('error', null), now).state, 'failing');
});

test('freshness: live, delayed, failing', () => {
  assert.equal(connectionStatus(stripe, env, run('ok', 10), now).state, 'live');
  assert.equal(connectionStatus(stripe, env, run('ok', 45), now).state, 'delayed');
  assert.equal(connectionStatus(stripe, env, run('ok', 120), now).state, 'failing');
  assert.equal(connectionStatus(stripe, env, run('error', 5), now).state, 'failing');
});

test('status never echoes credential values', () => {
  assert.ok(!JSON.stringify(connectionStatus(stripe, env, undefined, now)).includes('rk_live'));
});

test('overview tiles carry no values until a source syncs', () => {
  const conns = new Map<SourceKey, ConnectionStatus>(SOURCES.map((s) => [s.key, connectionStatus(s, {}, undefined, now)]));
  const tiles = buildTiles(conns, { current: 0, previous: 0, hasEntries: false });
  assert.equal(tiles.length, 8);
  for (const t of tiles) assert.equal(t.value, null, t.key);
  assert.equal(tiles.find((t) => t.key === 'expenses')?.state, 'empty');
  const withExpenses = buildTiles(conns, { current: 4200, previous: 3000, hasEntries: true }).find((t) => t.key === 'expenses');
  assert.deepEqual([withExpenses?.state, withExpenses?.value, withExpenses?.previous], ['manual', 4200, 3000]);
});
