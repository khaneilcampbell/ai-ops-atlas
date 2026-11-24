// Synthetic agents and runs for tests and the local preview. Made up: no real names, ids, keys or
// payloads. One agent per case the report must tell apart (docs/agent-self-reports.md).
const NOW = Date.UTC(2026, 10, 23, 16, 0); // 23 Nov 2026, 11:00 AM New York
const iso = (daysAgo, hourUtc, min) => new Date(Date.UTC(2026, 10, 23 - daysAgo, hourUtc, min || 0)).toISOString();
const exec = (daysAgo, hourUtc, seconds, status, mode) => ({ startedAt: iso(daysAgo, hourUtc), stoppedAt: new Date(Date.parse(iso(daysAgo, hourUtc)) + seconds * 1000).toISOString(), status, mode });
const ghRun = (daysAgo, hourUtc, seconds, conclusion, event) => ({ run_started_at: iso(daysAgo, hourUtc), created_at: iso(daysAgo, hourUtc), updated_at: new Date(Date.parse(iso(daysAgo, hourUtc)) + seconds * 1000).toISOString(), status: 'completed', conclusion, event });
const sched = (hour) => ({ type: 'n8n-nodes-base.scheduleTrigger', parameters: { rule: { interval: [{ field: 'days', triggerAtHour: hour, triggerAtMinute: 0 }] } } });

function synthetic(overrides) {
  const agents = [
    { id: 'steady-scheduler', name: 'Avery Stone', role: 'Steady Scheduler', project: 'Demo HQ', status: 'active', slot: '09:00', budget: '$5 a month cap', n8n: ['wfSteady01'], gh: [], owned: [] },
    { id: 'flaky-builder', name: 'Blake Fern', role: 'Flaky Builder', project: 'Demo HQ', status: 'active', slot: '09:30', n8n: [], gh: [{ repo: 'demo/app', file: 'build.yml' }], owned: [] },
    { id: 'quiet-watcher', name: 'Casey Moor', role: 'Quiet Watcher', project: 'Demo Lab', status: 'active', slot: '10:00', n8n: ['wfQuiet001'], gh: [], owned: [] },
    { id: 'on-request', name: 'Drew Lake', role: 'On-Request Helper', project: 'Demo Lab', status: 'active', slot: '10:30', n8n: [], gh: [], owned: [] },
    { id: 'unreachable', name: 'Emery Vale', role: 'Unreachable Agent', project: 'Demo Lab', status: 'active', slot: '11:00', n8n: ['wfLocked01'], gh: [], owned: [] },
    { id: 'draft-keeper', name: 'Finley Ash', role: 'Draft Keeper', project: 'Demo Lab', status: 'active', slot: '11:30', n8n: ['wfDraft001'], gh: [], owned: [] },
    { id: 'hand-runner', name: 'Gray Holt', role: 'Hand Runner', project: 'Demo HQ', status: 'active', slot: '12:00', n8n: ['wfManual01'], gh: [], owned: [{ id: 'hand-runner-sync' }] },
  ];
  const wf = new Map([
    ['wfSteady01', { id: 'wfSteady01', name: 'Steady report', active: true, settings: {}, nodes: [sched(7)] }],
    ['wfQuiet001', { id: 'wfQuiet001', name: 'Quiet check', active: true, settings: { saveDataSuccessExecution: 'none' }, nodes: [{ type: 'n8n-nodes-base.webhook', parameters: {} }] }],
    ['wfDraft001', { id: 'wfDraft001', name: 'Draft flow', active: false, settings: {}, nodes: [sched(14)] }],
    ['wfManual01', { id: 'wfManual01', name: 'Manual sync', active: true, settings: {}, nodes: [] }],
  ]);
  const steady = []; for (let d = 0; d < 7; d++) steady.push(exec(d, 12, 40 + d, 'success', 'trigger'));
  steady.push(exec(1, 12, 900, 'success', 'trigger')); // one slow run
  const manual = []; for (let d = 0; d < 6; d++) manual.push(exec(d, 18, 20, 'success', d < 4 ? 'manual' : 'webhook'));
  const execs = new Map([['wfSteady01', steady], ['wfQuiet001', []], ['wfDraft001', []], ['wfManual01', manual]]);
  const ghRuns = new Map([['demo/app/build.yml', [ghRun(0, 14, 300, 'failure', 'push'), ghRun(2, 14, 280, 'success', 'push'), ghRun(3, 9, 290, 'failure', 'schedule'), ghRun(5, 9, 310, 'success', 'schedule')]]]);
  const ctx = {
    nowMs: NOW, tz: 'America/New_York', wf, execs,
    n8nErr: new Map([['wfLocked01', 'HTTP 401']]),
    ghRuns, ghCron: new Map([['demo/app/build.yml', ['0 9 * * *']]]), ghErr: new Map(),
    atlas: { connected: false, note: 'Not connected yet: the report key is not set up', by: new Map() },
    n8nFrom: iso(7, 12),
  };
  return Object.assign({ agents, ctx }, overrides && overrides(agents, ctx));
}
module.exports = { synthetic, NOW };
