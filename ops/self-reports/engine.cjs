// Agent self-reports engine (docs/agent-self-reports.md). Plain JavaScript with no imports and no AI:
// the n8n workflow "Data Intelligence · Agent Self-Reports" pastes this whole file into its Build
// Reports Code node (ops/self-reports/build-n8n.mjs), and the tests and the synthetic preview load the same file,
// so what is tested is what runs. Everything here is a pure function of its inputs.
//
// Words that mean different things and are never mixed up:
//   "No data"        the agent has no workflow linked, so there is nothing to count
//   "0 runs"         its workflows were read and none ran in the window
//   "Not connected"  a source could not be read (no key, an error); its numbers are unknown, not zero
//   "Not documented" the catalog says nothing (budgets, limits)

const DEFAULT_TZ = 'America/New_York';
const DAY_START = 7 * 60, DAY_END = 21 * 60 + 30, STEP = 30, VISIT = 15;
const GITHUB_DAYS = 30, QUIET_DAYS = 7;
const NO_DATA = 'No data: no workflow linked';
const NOT_DOCUMENTED = 'Not documented';
const REVIEW_STATUS = 'Not reviewed: suggestion only, nothing was changed';

// ---------------------------------------------------------------- time, in the Atlas time zone

const partsCache = new Map();
function zonedParts(ms, tz) {
  let f = partsCache.get(tz);
  if (!f) { f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric' }); partsCache.set(tz, f); }
  const o = {}; for (const p of f.formatToParts(new Date(ms))) o[p.type] = p.value;
  return { y: +o.year, mo: +o.month, d: +o.day, h: +o.hour % 24, mi: +o.minute };
}
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const clock12 = (h, mi) => (h % 12 || 12) + ':' + String(mi).padStart(2, '0') + ' ' + (h < 12 ? 'AM' : 'PM');
const hourLabel = (h) => (h % 12 || 12) + ' ' + (h < 12 ? 'AM' : 'PM');
/** "16 Nov, 7:23 AM" in the zone; '' for no time. */
function fmtLocal(iso, tz) { if (!iso) return ''; const z = zonedParts(Date.parse(iso), tz); return z.d + ' ' + MONTHS[z.mo - 1] + ', ' + clock12(z.h, z.mi); }
/** "16 Nov 2026" in the zone. */
function fmtDay(ms, tz) { const z = zonedParts(ms, tz); return z.d + ' ' + MONTHS[z.mo - 1] + ' ' + z.y; }
/** "Sun 22 Nov 2026, 11:07 PM" in the zone. */
function fmtStamp(ms, tz) { const d = new Date(ms); const wd = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' }).format(d); const z = zonedParts(ms, tz); return wd + ' ' + z.d + ' ' + MONTHS[z.mo - 1] + ' ' + z.y + ', ' + clock12(z.h, z.mi); }
const minOfDay = (iso, tz) => { const z = zonedParts(Date.parse(iso), tz); return z.h * 60 + z.mi; };
const hhmm = (m) => String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
function fmtDur(s) { if (s == null) return ''; return s < 90 ? Math.round(s) + ' s' : s < 5400 ? Math.round(s / 60) + ' min' : (s / 3600).toFixed(1) + ' h'; }
function median(xs) { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; }
const hashOf = (s) => { let h = 2166136261; for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; } return h; };
const plural = (n, word) => n + ' ' + word + (n === 1 ? '' : 's');

// ---------------------------------------------------------------- schedules and report times

/** Busy windows (minutes of the day): each run 15 min either side (weight 1), each schedule time -20/+15 (weight 5). */
function busyOf(runs, schedules, tz) {
  const out = [];
  for (const r of runs) { if (!r.startedAt) continue; const s = minOfDay(r.startedAt, tz); const d = Math.max(1, Math.round((r.durationS || 0) / 60)); out.push({ from: s - 15, to: s + d + 15, w: 1 }); }
  for (const t of schedules) out.push({ from: t - 20, to: t + 15, w: 5 });
  return out;
}
function scoreSlot(slot, busy) {
  let score = 0;
  for (const b of busy) for (const shift of [-1440, 0, 1440]) {
    const from = b.from + shift, to = b.to + shift;
    if (slot < to && slot + VISIT > from) score += b.w * 3;
    else if (Math.min(Math.abs(slot - to), Math.abs(slot + VISIT - from)) <= 60) score += b.w;
  }
  return score;
}
/**
 * One report time per agent on a 30 minute grid from 07:00 to 21:30: the agent with the most history
 * picks first, lowest clash score wins, no two agents share a slot. More agents than slots: the rest
 * get "No free slot" instead of a clash.
 */
function pickSlots(agents) {
  const grid = []; for (let m = DAY_START; m <= DAY_END; m += STEP) grid.push(m);
  const taken = new Set(), result = {};
  const weight = (a) => a.busy.reduce((s, x) => s + x.w, 0);
  const order = [...agents].sort((a, b) => weight(b) - weight(a) || a.id.localeCompare(b.id));
  for (const a of order) {
    const free = grid.filter((m) => !taken.has(m));
    if (!free.length) { result[a.id] = { slot: '', score: null, reason: 'No free slot left on the grid: add slots or report less often' }; continue; }
    const typical = median(a.busy.filter((b) => b.w === 1).map((b) => b.from + 15));
    const target = typical == null ? 10 * 60 + (hashOf(a.id) % 8) * 30 : Math.min(DAY_END, Math.max(DAY_START, typical + 120));
    const best = free.map((m) => ({ m, s: scoreSlot(m, a.busy), d: Math.abs(m - target), h: hashOf(a.id + m) })).sort((x, y) => x.s - y.s || x.d - y.d || x.h - y.h)[0];
    taken.add(best.m);
    const reason = !a.busy.length ? 'No run history or schedule yet: a quiet default time'
      : best.s === 0 ? 'Clear of every run and schedule seen (none within an hour)'
      : 'Fewest overlaps with its runs and schedules (score ' + best.s + ')';
    result[a.id] = { slot: hhmm(best.m), score: best.s, reason };
  }
  return result;
}
/** Report times that two agents share, as "HH:MM: a, b" lines (the yaml and the trigger must not have any). */
function slotConflicts(slots) {
  const by = {}; for (const [id, t] of Object.entries(slots)) if (t) (by[t] = by[t] || []).push(id);
  return Object.entries(by).filter(([, ids]) => ids.length > 1).map(([t, ids]) => t + ': ' + ids.sort().join(', '));
}
/** Times of day (minutes, in `tz`) from a cron line. GitHub crons are UTC; n8n cron may carry seconds. */
function cronTimes(expr, cronZone, tz, maybeSeconds) {
  let f = String(expr || '').trim().split(/\s+/); if (maybeSeconds && f.length === 6) f = f.slice(1);
  if (f.length < 5) return [];
  const list = (s, max) => { const out = new Set(); for (const part of s.split(',')) { const [r, st] = part.split('/'); const step = Number(st || 1); let [a, b] = r === '*' ? [0, max - 1] : r.split('-').map(Number); if (b == null) b = st ? max - 1 : a; if (!Number.isFinite(a) || !Number.isFinite(b) || step < 1) return []; for (let v = a; v <= b; v += step) out.add(v); } return [...out]; };
  const mins = list(f[0], 60), hours = list(f[1], 24), out = [];
  for (const h of hours) for (const m of mins) {
    if (cronZone === 'UTC') { const z = zonedParts(Date.UTC(2026, 10, 23, h, m), tz); out.push(z.h * 60 + z.mi); } else out.push(h * 60 + m);
  }
  return out.length > 96 ? [] : out;
}
/** Schedule Trigger times (minutes of the day) of an n8n workflow. */
function n8nSchedules(wf, tz) {
  const out = [];
  for (const n of (wf && wf.nodes) || []) {
    if (n.type !== 'n8n-nodes-base.scheduleTrigger' || n.disabled) continue;
    for (const r of (n.parameters && n.parameters.rule && n.parameters.rule.interval) || []) {
      const min = Number(r.triggerAtMinute ?? 0) || 0, hr = Number(r.triggerAtHour ?? 0) || 0;
      if (r.field === 'hours') { const step = Math.max(1, Number(r.hoursInterval || 1)); for (let h = 0; h < 24; h += step) out.push(h * 60 + min); }
      else if (r.field === 'minutes') { const step = Math.max(5, Number(r.minutesInterval || 5)); for (let m = 0; m < 1440; m += step) out.push(m); }
      else if (r.field === 'cronExpression') out.push(...cronTimes(r.expression, 'local', tz, true));
      else out.push(hr * 60 + min);
    }
  }
  return out;
}
const scheduleLine = (label, times, suffix) => { const u = [...new Set(times)].sort((x, y) => x - y); return label + ': ' + u.slice(0, 6).map(hhmm).join(', ') + (u.length > 6 ? ' (' + u.length + ' a day)' : '') + (suffix || ''); };

// ---------------------------------------------------------------- runs from each source

function n8nRun(e, label) {
  const status = e.status === 'success' ? 'succeeded' : (e.status === 'error' || e.status === 'crashed') ? 'failed' : e.status === 'running' || e.status === 'waiting' || e.status === 'new' ? 'running' : (e.status || 'other');
  const mode = e.mode === 'trigger' ? 'scheduled' : e.mode === 'webhook' || e.mode === 'error' || e.mode === 'integrated' ? 'event' : e.mode === 'manual' ? 'manual' : 'other';
  return { source: 'n8n', workflow: label, startedAt: e.startedAt, durationS: e.stoppedAt && e.startedAt ? Math.max(0, (Date.parse(e.stoppedAt) - Date.parse(e.startedAt)) / 1000) : null, status, mode };
}
function githubRun(r, file) {
  const st = r.run_started_at || r.created_at;
  const status = r.status !== 'completed' ? 'running' : r.conclusion === 'success' ? 'succeeded' : ['failure', 'timed_out', 'startup_failure'].includes(r.conclusion) ? 'failed' : (r.conclusion || 'other');
  return { source: 'GitHub', workflow: file, startedAt: st, durationS: r.updated_at && st && status !== 'running' ? Math.max(0, (Date.parse(r.updated_at) - Date.parse(st)) / 1000) : null, status, mode: r.event === 'schedule' ? 'scheduled' : r.event === 'workflow_dispatch' ? 'manual' : 'event' };
}

// ---------------------------------------------------------------- recommendation rules

/** Every rule, in priority order. The id and the condition are shown with each recommendation. */
const RULES = [
  { id: 'failed-runs', condition: 'At least one failed run in the window' },
  { id: 'source-unavailable', condition: 'A linked workflow could not be read, so its runs are unknown' },
  { id: 'successes-not-kept', condition: 'An n8n workflow does not save successful executions' },
  { id: 'active-but-quiet', condition: 'Catalog says active, its workflows were read, and no run was seen in the last ' + QUIET_DAYS + ' days' },
  { id: 'drafts-as-operational', condition: 'Catalog says active but some of its n8n workflows are unpublished drafts' },
  { id: 'no-workflow', condition: 'No n8n or GitHub workflow is linked in the catalog' },
  { id: 'slow-run', condition: 'Longest run over 60 s and more than 3 times the median' },
  { id: 'mostly-manual', condition: 'At least 5 runs and more than half started by hand' },
  { id: 'memory-empty', condition: 'Atlas memory is connected and holds no lessons for its runs' },
];
const PRIORITY = { High: 0, Medium: 1, Low: 2 };
const ruleOf = (id) => RULES.find((r) => r.id === id);

// ---------------------------------------------------------------- one agent's report

/**
 * One agent's report from the reads of one cycle.
 * ctx: { nowMs, tz, wf: Map id->workflow|null, execs: Map id->executions[], n8nErr: Map id->message,
 *        ghRuns: Map key->runs[], ghTotal: Map key->total runs GitHub has, ghCron: Map key->cron[], ghErr: Map key->message,
 *        atlas: { connected, note, by: Map catalogId->counts }, n8nFrom: iso|null }
 * agent: { id, name, role, project, status, slot, budget, n8n: [ids], gh: [{repo,file}], owned: [{id}] }
 */
function agentReport(agent, ctx) {
  const tz = ctx.tz || DEFAULT_TZ, now = ctx.nowMs;
  const runs = [], schedules = [], scheduleText = [], drafts = [], published = [], notKept = [], unreadable = [];
  for (const id of agent.n8n || []) {
    if (ctx.n8nErr && ctx.n8nErr.has(id)) { unreadable.push('n8n ' + id + ' (' + ctx.n8nErr.get(id) + ')'); continue; }
    const wf = ctx.wf.get(id);
    const label = wf ? wf.name : id;
    if (wf) {
      if (wf.active) { published.push(label); const t = n8nSchedules(wf, tz); schedules.push(...t); if (t.length) scheduleText.push(scheduleLine(label, t)); } else drafts.push(label);
      if ((wf.settings || {}).saveDataSuccessExecution === 'none') notKept.push(label);
    }
    for (const e of ctx.execs.get(id) || []) if (e.startedAt) runs.push(n8nRun(e, label));
  }
  const ghFiles = [], ghCut = [];
  for (const g of agent.gh || []) {
    const k = g.repo + '/' + g.file; ghFiles.push(g.file);
    const total = ctx.ghTotal && ctx.ghTotal.get(k), got = (ctx.ghRuns.get(k) || []).length;
    if (total && total > got) ghCut.push(g.file + ' (newest ' + got + ' of ' + total + ')');
    if (ctx.ghErr && ctx.ghErr.has(k)) { unreadable.push('GitHub ' + g.file + ' (' + ctx.ghErr.get(k) + ')'); continue; }
    for (const c of ctx.ghCron.get(k) || []) { const t = cronTimes(c, 'UTC', tz); schedules.push(...t); if (t.length) scheduleText.push(scheduleLine(g.file, t, ' (GitHub cron)')); }
    for (const r of ctx.ghRuns.get(k) || []) if (r.run_started_at || r.created_at) runs.push(githubRun(r, g.file));
  }
  runs.sort((x, y) => Date.parse(y.startedAt) - Date.parse(x.startedAt));
  const linked = (agent.n8n || []).length + (agent.gh || []).length;
  const readable = linked - unreadable.length;
  const state = !linked ? 'no-workflow' : !readable ? 'not-connected' : unreadable.length ? 'partial' : 'ok';
  const ok = runs.filter((r) => r.status === 'succeeded'), bad = runs.filter((r) => r.status === 'failed');
  const finished = ok.length + bad.length;
  const durs = runs.map((r) => r.durationS).filter((d) => d != null && d >= 0);
  const md = median(durs), mx = durs.length ? Math.max(...durs) : null;
  const recent = runs.filter((r) => now - Date.parse(r.startedAt) < QUIET_DAYS * 86400000);
  const manual = runs.filter((r) => r.mode === 'manual').length, scheduled = runs.filter((r) => r.mode === 'scheduled').length, event = runs.filter((r) => r.mode === 'event').length;
  const hours = {}; for (const r of runs) { const h = zonedParts(Date.parse(r.startedAt), tz).h; hours[h] = (hours[h] || 0) + 1; }
  const busiest = runs.length >= 3 ? Object.entries(hours).sort((x, y) => y[1] - x[1] || x[0] - y[0]).slice(0, 3).map(([h, n]) => hourLabel(Number(h)) + ' (' + n + ')').join(', ') : '';
  const lastRun = runs[0], lastFail = bad[0];
  const successRate = finished ? Math.round((ok.length / finished) * 100) : null;
  const live = state === 'no-workflow' ? 'No workflow linked' : state === 'not-connected' ? 'Not connected' : drafts.length && !published.length && !(agent.gh || []).length ? 'Draft (switched off)'
    : !recent.length ? 'Quiet: no runs in the last ' + QUIET_DAYS + ' days' : schedules.length && scheduled ? 'Scheduled' : manual > recent.length / 2 ? 'Manual' : 'Event-triggered';
  // Windows: n8n keeps what it keeps (back to ctx.n8nFrom); GitHub is read for GITHUB_DAYS.
  const windows = [];
  if ((agent.n8n || []).length) windows.push('n8n ' + (ctx.n8nFrom ? 'since ' + fmtDay(Date.parse(ctx.n8nFrom), tz) + ' (what n8n still keeps)' : 'retention unknown'));
  if ((agent.gh || []).length) windows.push('GitHub last ' + GITHUB_DAYS + ' days' + (ghCut.length ? ', newest runs only: ' + ghCut.join(', ') : ''));
  const nOf = (src) => runs.filter((r) => r.source === src).length;
  const runsSeen = state === 'no-workflow' ? NO_DATA : state === 'not-connected' ? 'Not connected: ' + unreadable.join('; ')
    : [(agent.n8n || []).length ? nOf('n8n') + ' n8n' : '', (agent.gh || []).length ? nOf('GitHub') + ' GitHub' : ''].filter(Boolean).join(' + ') + ' = ' + plural(runs.length, 'run') + (state === 'partial' ? ' (some workflows not read)' : '');
  const atl = [agent.id, ...(agent.owned || []).map((o) => o.id)].map((id) => ctx.atlas.by.get(id)).filter(Boolean);
  const sum = (k) => atl.reduce((s, x) => s + (Number(x[k]) || 0), 0);
  const atlasText = (v) => (ctx.atlas.connected ? v : 'Not connected');

  // Stale-data warnings: what the numbers can't tell.
  const stale = [];
  if (!linked) stale.push('No workflow linked in the catalog: nothing to measure');
  if (unreadable.length) stale.push('Not read: ' + unreadable.join('; '));
  if (notKept.length) stale.push('Successful runs not kept (' + notKept.join(', ') + '): only failures show, so no failures seen does not mean healthy');
  if (readable && lastRun && now - Date.parse(lastRun.startedAt) > QUIET_DAYS * 86400000) stale.push('Last run seen ' + fmtLocal(lastRun.startedAt, tz) + ', over ' + QUIET_DAYS + ' days ago');
  if (readable && !runs.length) stale.push('No runs in the window: health unknown, not proven');
  if (drafts.length) stale.push('Draft workflows: ' + drafts.join(', '));
  if (ghCut.length) stale.push('GitHub runs cut at one page: ' + ghCut.join(', ') + ', so counts cover less than 30 days');

  // Recommendations from RULES, each with its evidence.
  const recs = [];
  const rec = (id, priority, text, evidence) => recs.push({ rule: id, condition: ruleOf(id).condition, priority, text, evidence });
  if (bad.length) rec('failed-runs', (successRate != null && successRate < 80) || (lastRun && lastRun.status === 'failed') ? 'High' : 'Medium', 'Review the failed run' + (bad.length > 1 ? 's' : '') + ': the latest was ' + lastFail.workflow + ' (' + lastFail.source + ') at ' + fmtLocal(lastFail.startedAt, tz) + '.', plural(bad.length, 'failed run') + ' of ' + finished + ' finished (' + successRate + '% succeeded)' + (lastRun.status === 'failed' ? '; the latest run failed' : ''));
  if (unreadable.length) rec('source-unavailable', 'Medium', 'Check the connection Atlas uses to read ' + unreadable.map((u) => u.replace(/ \(.*$/, '')).join(', ') + ', so its runs can be counted.', unreadable.join('; '));
  if (notKept.length) rec('successes-not-kept', 'Medium', 'In n8n, set "Save successful production executions" to Save for ' + notKept.join(', ') + ', so Atlas sees successes, not only failures.', 'saveDataSuccessExecution is "none" on ' + notKept.join(', '));
  if (agent.status === 'active' && readable && !recent.length && !(drafts.length && !published.length && !(agent.gh || []).length)) rec('active-but-quiet', 'Medium', 'Check that its trigger still fires, or set its catalog status to idle.', lastRun ? 'Last run ' + fmtLocal(lastRun.startedAt, tz) : 'No runs in the window (' + windows.join('; ') + ')');
  if (agent.status === 'active' && drafts.length) rec('drafts-as-operational', 'Low', 'Have its owner publish or retire ' + drafts.join(', ') + ': drafts never run on their own.', plural(drafts.length, 'draft workflow') + ' while the catalog says active');
  if (!linked) rec('no-workflow', 'Low', 'Link the automation it runs in the catalog, or document that it works only on request.', 'No n8n or GitHub workflow linked');
  if (md != null && mx > 60 && mx > 3 * md) rec('slow-run', 'Low', 'Review slow steps or timeouts: one run took ' + fmtDur(mx) + ' against a usual ' + fmtDur(md) + '.', 'Longest ' + fmtDur(mx) + ', median ' + fmtDur(md) + ' over ' + plural(durs.length, 'run'));
  if (runs.length >= 5 && manual / runs.length > 0.5) rec('mostly-manual', 'Low', 'Consider a schedule or event trigger: most runs were started by hand.', manual + ' of ' + runs.length + ' runs manual');
  if (ctx.atlas.connected && readable && runs.length && sum('memoryItems') === 0) rec('memory-empty', 'Low', 'Record a lesson in Atlas memory after a failure or a fix, so the next run starts from it.', '0 memory items for its runs');
  recs.sort((x, y) => PRIORITY[x.priority] - PRIORITY[y.priority]);

  // Numbers stay blank (never 0) when nothing could be counted; text columns say why.
  const missing = state === 'no-workflow' ? 'No data' : 'Not connected';
  const row = {
    agent_id: agent.id, agent: agent.name, role: agent.role, works_in: agent.project || '', reports_at_et: agent.slot || 'Not set',
    catalog_status: agent.status || NOT_DOCUMENTED, live_state: live, data_state: state === 'ok' ? 'Read' : state === 'partial' ? 'Partly read' : state === 'not-connected' ? 'Not connected' : 'No data',
    window: windows.join('; ') || 'None', runs_seen: runsSeen,
    runs_total: readable ? runs.length : '', succeeded: readable ? ok.length : '', failed: readable ? bad.length : '', other: readable ? runs.length - finished : '',
    success_rate: successRate == null ? (readable ? (runs.length ? 'No finished runs' : 'No runs in the window') : missing) : successRate + '%',
    median_duration: fmtDur(md), longest_duration: fmtDur(mx),
    last_run: lastRun ? fmtLocal(lastRun.startedAt, tz) + ' · ' + lastRun.status + ' · ' + lastRun.source + ' ' + lastRun.workflow : readable ? 'None in the window' : missing,
    last_failure: lastFail ? fmtLocal(lastFail.startedAt, tz) + ' · ' + lastFail.source + ' ' + lastFail.workflow : readable ? 'None in the window' : missing,
    scheduled_runs: readable ? scheduled : '', event_runs: readable ? event : '', manual_runs: readable ? manual : '',
    busiest_hours_et: busiest || (readable ? 'Not enough runs (fewer than 3)' : missing),
    github_workflows: ghFiles.join(', ') || 'None linked', n8n_published: published.join(', ') || 'None', n8n_drafts: drafts.join(', ') || 'None',
    schedules_et: scheduleText.join(' | ') || (linked ? 'No schedule: events or by hand' : 'None'),
    atlas_runs: atlasText(sum('runs')), atlas_memory_items: atlasText(sum('memoryItems')), atlas_cost_usd: atlasText(sum('costUsd').toFixed(2)),
    memory_service: ctx.atlas.connected ? 'Connected' : ctx.atlas.note,
    budget: agent.budget || NOT_DOCUMENTED, stale_flags: stale.join(' · ') || 'None', recommendations: recs.length,
  };
  return { row, recs, runs, schedules, busy: busyOf(runs, schedules, tz) };
}

// ---------------------------------------------------------------- the cycle

/** Where every number came from: name, collection time, coverage, retention, availability. */
function sourcesOf(ctx, agents, extra) {
  const tz = ctx.tz || DEFAULT_TZ, at = new Date(ctx.nowMs).toISOString(), to = fmtDay(ctx.nowMs, tz);
  const n8nIds = [...new Set(agents.flatMap((a) => a.n8n || []))], ghKeys = [...new Set(agents.flatMap((a) => (a.gh || []).map((g) => g.repo + '/' + g.file)))];
  const n8nBad = n8nIds.filter((id) => ctx.n8nErr && ctx.n8nErr.has(id)).length, ghBad = ghKeys.filter((k) => ctx.ghErr && ctx.ghErr.has(k)).length;
  const avail = (n, bad) => (!n ? 'Not used' : !bad ? 'Available' : bad === n ? 'Unavailable' : 'Partly available (' + bad + ' of ' + n + ' not read)');
  const rows = [
    { source: 'Atlas catalog', holds: 'Agents, status, owned automations, links, budgets', collected_at: at, coverage: 'Current main branch', retention: 'Git history (permanent)', availability: (extra && extra.catalog) || 'Available', note: plural(agents.length, 'agent') },
    { source: 'n8n executions', holds: 'Runs, durations, modes; workflow published or draft, schedules, saving settings', collected_at: at, coverage: ctx.n8nFrom ? fmtDay(Date.parse(ctx.n8nFrom), tz) + ' to ' + to : 'No executions seen', retention: ctx.n8nFrom ? 'About ' + Math.max(1, Math.round((ctx.nowMs - Date.parse(ctx.n8nFrom)) / 86400000)) + ' days (oldest execution n8n still keeps)' : 'Unknown', availability: avail(n8nIds.length, n8nBad), note: plural(n8nIds.length, 'workflow') + ' read with a read-only key; workflows that do not save successes show only failures' },
    { source: 'GitHub Actions', holds: 'Workflow runs and cron schedules', collected_at: at, coverage: fmtDay(ctx.nowMs - GITHUB_DAYS * 86400000, tz) + ' to ' + to, retention: 'Last ' + GITHUB_DAYS + ' days read (GitHub keeps longer)', availability: avail(ghKeys.length, ghBad), note: plural(ghKeys.length, 'workflow file') + ', read only, newest 100 runs per file' + (ctx.ghTotal ? ' (' + ghKeys.filter((k) => (ctx.ghTotal.get(k) || 0) > (ctx.ghRuns.get(k) || []).length).length + ' cut short)' : '') },
    { source: 'Atlas records (memory service)', holds: 'Runs, failures, tokens, cost, memory items and feedback per agent (counts only)', collected_at: at, coverage: ctx.atlas.connected ? 'Last ' + (ctx.atlas.windowDays || 30) + ' days' : 'None', retention: ctx.atlas.connected ? 'Database (permanent)' : 'Unknown until connected', availability: ctx.atlas.connected ? 'Available' : 'Not connected', note: ctx.atlas.note },
    { source: 'Report times', holds: 'Each agent\'s daily report time', collected_at: at, coverage: 'Current', retention: 'Git history', availability: 'Available', note: (extra && extra.slotSource) || 'catalog/workspace/self-reports.yaml' },
  ];
  return rows;
}
function countsOf(rows, recs) {
  const n = (k) => rows.reduce((s, r) => s + (typeof r[k] === 'number' ? r[k] : 0), 0);
  const fin = n('succeeded') + n('failed');
  const by = (s) => rows.filter((r) => r.data_state === s).length;
  return { agents: rows.length, runs: n('runs_total'), succeeded: n('succeeded'), failed: n('failed'), successRate: fin ? Math.round((n('succeeded') / fin) * 100) : null,
    read: by('Read') + by('Partly read'), noData: by('No data'), notConnected: by('Not connected'), withRuns: rows.filter((r) => typeof r.runs_total === 'number' && r.runs_total > 0).length,
    recs: recs.length, high: recs.filter((r) => r.priority === 'High').length, medium: recs.filter((r) => r.priority === 'Medium').length, low: recs.filter((r) => r.priority === 'Low').length,
    stale: rows.filter((r) => r.stale_flags && r.stale_flags !== 'None').length };
}
/** Workbook "Workflow Recommendations" rows. */
function recRows(reports, nowIso) {
  return reports.flatMap((r) => r.recs.map((x) => ({ rec_key: r.row.agent_id + ':' + x.rule, agent_id: r.row.agent_id, agent: r.row.agent, priority: x.priority, rule: x.rule, condition: x.condition, evidence: x.evidence, suggested_change: x.text, review_status: REVIEW_STATUS, last_seen: nowIso })));
}

// ---------------------------------------------------------------- PDF (Helvetica, Letter, no outside service)

function buildPdf(c) {
  const tz = c.tz || DEFAULT_TZ;
  const W = 612, H = 792, X0 = 44, X1 = W - 44;
  const pages = []; let ops = [], y = 0;
  const lat = (s) => String(s == null ? '' : s).replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-').replace(/→/g, '->').replace(/[^\x20-\x7E\xA0-\xFF]/g, '?');
  const esc = (s) => lat(s).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  const rgb = (hex) => [1, 3, 5].map((i) => (parseInt(hex.slice(i, i + 2), 16) / 255).toFixed(3)).join(' ');
  const widthOf = (s, size, bold) => lat(s).length * size * (bold ? 0.56 : 0.5);
  const text = (x, yy, s, size, bold, color) => ops.push('BT /' + (bold ? 'F2' : 'F1') + ' ' + size + ' Tf ' + rgb(color || '#1F2933') + ' rg ' + x.toFixed(1) + ' ' + yy.toFixed(1) + ' Td (' + esc(s) + ') Tj ET');
  const rect = (x, yy, w, h, color) => ops.push(rgb(color) + ' rg ' + [x, yy, w, h].map((v) => v.toFixed(1)).join(' ') + ' re f');
  const wrap = (s, size, maxW, bold) => { const words = lat(s).split(/\s+/), lines = []; let cur = ''; for (const w of words) { const t = cur ? cur + ' ' + w : w; if (widthOf(t, size, bold) > maxW && cur) { lines.push(cur); cur = w; } else cur = t; } if (cur) lines.push(cur); return lines.length ? lines : ['']; };
  const footer = () => { text(X0, 24, 'Atlas · Data Intelligence Center · agent self-reports · ' + c.stamp + '. Deterministic counts, no AI. Recommendations are suggestions; nothing was changed.', 6.5, false, '#6B7280'); text(X1 - 30, 24, 'Page ' + (pages.length + 1), 7, false, '#6B7280'); };
  const newPage = () => { if (ops.length) { footer(); pages.push(ops.join('\n')); } ops = []; y = H - 50; };
  const need = (h) => { if (y - h < 48) newPage(); };
  const para = (s, size, bold, color, x, maxW) => { size = size || 9; x = x == null ? X0 : x; maxW = maxW || X1 - x; for (const l of wrap(s, size, maxW, bold)) { need(size * 1.35); text(x, y, l, size, bold, color); y -= size * 1.35; } };
  const heading = (s) => { need(30); y -= 10; para(s, 13, true, '#0F3D2E'); y -= 4; };
  newPage();
  rect(0, H - 120, W, 120, '#0F3D2E');
  text(X0, H - 62, 'Atlas Agent Self-Reports', 24, true, '#FFFFFF');
  text(X0, H - 84, 'Operational review of every agent, reported to the Data Intelligence Center', 11, false, '#D1FAE5');
  text(X0, H - 102, 'Collected ' + c.stamp + ' (' + (tz === DEFAULT_TZ ? 'New York' : tz) + ') · ' + c.mode + ' · ' + c.scheduleState, 8, false, '#A7F3D0');
  y = H - 150;
  const k = c.counts;
  const tiles = [['Agents', k.agents], ['With run data', k.read], ['Runs seen', k.runs], ['Failed', k.failed], ['Suggestions', k.recs]];
  const tw = (X1 - X0 - 4 * 8) / 5;
  tiles.forEach(([label, v], i) => { const x = X0 + i * (tw + 8); rect(x, y - 46, tw, 52, '#ECFDF5'); text(x + 10, y - 14, String(v), 18, true, '#0F3D2E'); text(x + 10, y - 34, label, 8, false, '#4B5563'); });
  y -= 72;
  heading('Executive summary');
  para(k.agents + ' agents in the catalog. Run data was read for ' + k.read + '; ' + k.noData + ' have no workflow linked (no data, not zero runs)' + (k.notConnected ? ' and ' + k.notConnected + ' could not be read (not connected)' : '') + '. ' + k.runs + ' runs seen, ' + k.failed + ' failed' + (k.successRate == null ? '' : ' (' + k.successRate + '% of finished runs succeeded)') + '. Windows differ by source: see Sources at the end.', 9);
  para(k.recs + ' suggestions (' + k.high + ' high, ' + k.medium + ' medium, ' + k.low + ' low) for ' + new Set(c.recs.map((r) => r.agent_id)).size + ' agents. ' + k.stale + ' agents carry stale-data warnings. Atlas memory service: ' + c.memory + '.', 9);
  if (c.failures && c.failures.length) para('Not completed this cycle: ' + c.failures.join('; ') + '. Retry by running the workflow by hand.', 8.5, true, '#B91C1C');
  if (c.sheetUrl) para('Live sheet: ' + c.sheetUrl, 8, false, '#0F766E');
  heading('Report schedule (every day)');
  const cols = [[X0, 'Time'], [X0 + 50, 'Agent'], [X0 + 170, 'Why this time']];
  need(18); rect(X0, y - 5, X1 - X0, 16, '#0F3D2E'); cols.forEach(([x, h]) => text(x + 4, y, h, 8, true, '#FFFFFF')); y -= 18;
  c.schedule.forEach((s, i) => { const lines = wrap(s.why || s.state || '', 8, X1 - X0 - 176); const h = 12 * lines.length + 2; need(h); if (i % 2) rect(X0, y - h + 9, X1 - X0, h, '#F3F4F6');
    text(X0 + 4, y, s.reports_at_et || '-', 8, true); text(X0 + 54, y, s.agent, 8); lines.forEach((l, j) => text(X0 + 174, y - j * 12, l, 8, false, '#374151')); y -= h; });
  y -= 10;
  const recsBy = new Map(); for (const r of c.recs) { if (!recsBy.has(r.agent_id)) recsBy.set(r.agent_id, []); recsBy.get(r.agent_id).push(r); }
  const colW = (X1 - X0) / 2;
  for (const a of c.agents) {
    need(170);
    rect(X0, y - 8, X1 - X0, 24, '#E6F4EE'); rect(X0, y - 8, 4, 24, '#0F766E');
    text(X0 + 12, y, a.agent + ' · ' + a.role, 11, true, '#0F3D2E');
    text(X1 - 130, y, 'Reports at ' + (a.reports_at_et || '-'), 8, true, '#0F766E');
    y -= 28;
    const show = (v, unit) => (v === '' || v == null ? 'Unknown' : String(v) + (unit || ''));
    const facts = [['Catalog status', a.catalog_status], ['Live state', a.live_state], ['Data', a.data_state + ' · ' + a.window], ['Runs seen', a.runs_seen],
      ['Succeeded / failed', a.data_state === 'No data' ? 'No data' : show(a.succeeded) + ' / ' + show(a.failed) + (a.success_rate ? ' (' + a.success_rate + ')' : '')], ['Median / longest', (a.median_duration || '-') + ' / ' + (a.longest_duration || '-')],
      ['Last run', a.last_run || 'No data'], ['Last failure', a.last_failure || 'No data'],
      ['Scheduled / event / manual', a.data_state === 'No data' ? 'No data' : show(a.scheduled_runs) + ' / ' + show(a.event_runs) + ' / ' + show(a.manual_runs)], ['Busiest hours', a.busiest_hours_et || 'No data'],
      ['GitHub workflows', a.github_workflows], ['n8n published', a.n8n_published], ['n8n drafts', a.n8n_drafts], ['Atlas runs / memory', a.atlas_runs + ' / ' + a.atlas_memory_items]];
    for (let i = 0; i < facts.length; i += 2) {
      const cells = [facts[i], facts[i + 1]].filter(Boolean).map(([key, v], j) => ({ key, lines: wrap(String(v ?? ''), 8, colW - 112), x: X0 + j * colW }));
      const h = Math.max(...cells.map((x) => x.lines.length)) * 10 + 3; need(h);
      for (const cell of cells) { text(cell.x, y, cell.key, 7.5, false, '#6B7280'); cell.lines.forEach((l, j) => text(cell.x + 104, y - j * 10, l, 8)); }
      y -= h;
    }
    para('Schedules: ' + a.schedules_et, 7.5, false, '#374151');
    para('Memory service: ' + a.memory_service + ' · Budget: ' + a.budget, 7.5, false, '#6B7280');
    if (a.stale_flags && a.stale_flags !== 'None') para('Stale-data warnings: ' + a.stale_flags, 7.5, true, '#B45309');
    const rs = recsBy.get(a.agent_id) || [];
    y -= 2; para(rs.length ? 'To improve its workflow (suggestions, not applied)' : 'To improve its workflow: no rule matched', 8.5, true, '#0F3D2E');
    for (const r of rs) {
      const col = r.priority === 'High' ? '#B91C1C' : r.priority === 'Medium' ? '#B45309' : '#1D4ED8';
      need(24); text(X0 + 6, y, r.priority, 7.5, true, col);
      const ls = wrap(r.suggested_change, 8, X1 - X0 - 60); ls.forEach((l, j) => { if (j) { y -= 10; need(10); } text(X0 + 52, y, l, 8); }); y -= 10;
      para('Evidence: ' + r.evidence + ' · Rule: ' + r.condition, 7, false, '#6B7280', X0 + 52); y -= 2;
    }
    y -= 10;
  }
  heading('Sources and retention');
  for (const s of c.sources) { need(30); para(s.source + ' · ' + s.availability, 9, true, s.availability === 'Available' ? '#0F3D2E' : '#B45309'); para('Covers ' + s.coverage + ' · Retention: ' + s.retention + ' · Collected ' + fmtLocal(s.collected_at, tz) + (s.note ? ' · ' + s.note : ''), 7.5, false, '#374151'); y -= 3; }
  para('Figures from different sources cover different windows and are labelled with them. A workflow with no failures in view is not proven healthy, above all when it does not keep its successful runs.', 7.5, false, '#6B7280');
  footer(); pages.push(ops.join('\n'));
  const objs = [];
  objs[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objs[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
  objs[4] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>';
  const kids = [];
  pages.forEach((p, i) => { const pid = 5 + i * 2, cid = pid + 1; kids.push(pid + ' 0 R');
    objs[pid] = '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + W + ' ' + H + '] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ' + cid + ' 0 R >>';
    objs[cid] = '<< /Length ' + Buffer.byteLength(p, 'latin1') + ' >>\nstream\n' + p + '\nendstream'; });
  objs[2] = '<< /Type /Pages /Kids [' + kids.join(' ') + '] /Count ' + pages.length + ' >>';
  objs[objs.length] = '<< /Title (Atlas Agent Self-Reports) /Producer (Atlas Data Intelligence Center) >>';
  const infoId = objs.length - 1;
  let out = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n'; const offs = [];
  for (let i = 1; i < objs.length; i++) { offs[i] = Buffer.byteLength(out, 'latin1'); out += i + ' 0 obj\n' + objs[i] + '\nendobj\n'; }
  const xref = Buffer.byteLength(out, 'latin1');
  out += 'xref\n0 ' + objs.length + '\n0000000000 65535 f \n' + offs.slice(1).map((o) => String(o).padStart(10, '0') + ' 00000 n \n').join('');
  out += 'trailer\n<< /Size ' + objs.length + ' /Root 1 0 R /Info ' + infoId + ' 0 R >>\nstartxref\n' + xref + '\n%%EOF\n';
  return { bytes: Buffer.from(out, 'latin1'), pages: pages.length };
}

// ---------------------------------------------------------------- Excel workbook (.xlsx, stored zip)

const CRC_TABLE = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(buf) { let c = 0xffffffff; for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
/** A zip with no compression: enough for a valid .xlsx and no library needed. */
function zipStored(files) {
  const locals = [], centrals = []; let offset = 0;
  for (const f of files) {
    const name = Buffer.from(f.name, 'utf8'), data = Buffer.isBuffer(f.data) ? f.data : Buffer.from(f.data, 'utf8'), crc = crc32(data);
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6); lh.writeUInt16LE(0, 8); lh.writeUInt16LE(0, 10); lh.writeUInt16LE(0x5b21, 12);
    lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(name.length, 26); lh.writeUInt16LE(0, 28);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x0800, 8); ch.writeUInt16LE(0, 10); ch.writeUInt16LE(0, 12); ch.writeUInt16LE(0x5b21, 14);
    ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(data.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(name.length, 28); ch.writeUInt32LE(offset, 42);
    locals.push(lh, name, data); centrals.push(ch, name); offset += 30 + name.length + data.length;
  }
  const cd = Buffer.concat(centrals), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}
// Strips characters XML cannot hold: control characters and U+FFFE / U+FFFF (written as the characters
// themselves, because the n8n editor API turns \u escapes into characters and the copy must match).
const xmlText = (s) => String(s).replace(/[\x00-\x08\x0B\x0C\x0E-\x1F￾￿]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const colName = (i) => { let s = ''; i++; while (i) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };
function sheetXml(sheet) {
  const { columns, rows } = sheet;
  const cell = (v, r, ci, style) => { const ref = colName(ci) + r; if (v === '' || v == null) return '<c r="' + ref + '"' + (style ? ' s="' + style + '"' : '') + '/>'; if (typeof v === 'number' && Number.isFinite(v)) return '<c r="' + ref + '"' + (style ? ' s="' + style + '"' : '') + '><v>' + v + '</v></c>'; return '<c r="' + ref + '" t="inlineStr" s="' + (style || 2) + '"><is><t xml:space="preserve">' + xmlText(String(v).slice(0, 32000)) + '</t></is></c>'; };
  const head = '<row r="1">' + columns.map((c, i) => cell(c.title, 1, i, 1)).join('') + '</row>';
  const body = rows.map((r, ri) => '<row r="' + (ri + 2) + '">' + columns.map((c, i) => cell(r[c.key], ri + 2, i, 0)).join('') + '</row>').join('');
  const last = colName(columns.length - 1) + (rows.length + 1);
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>'
    + '<cols>' + columns.map((c, i) => '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + (c.width || 18) + '" customWidth="1"/>').join('') + '</cols>'
    + '<sheetData>' + head + body + '</sheetData><autoFilter ref="A1:' + last + '"/></worksheet>';
}
/** A workbook from [{ name, columns: [{key,title,width}], rows }]. */
function buildXlsx(sheets) {
  const ct = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
    + sheets.map((_, i) => '<Override PartName="/xl/worksheets/sheet' + (i + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>').join('') + '</Types>';
  const rels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>';
  const wb = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>'
    + sheets.map((s, i) => '<sheet name="' + xmlText(s.name.slice(0, 31)) + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>').join('') + '</sheets>'
    + '<definedNames>' + sheets.map((s, i) => '<definedName name="_xlnm._FilterDatabase" localSheetId="' + i + '" hidden="1">\'' + xmlText(s.name.slice(0, 31)) + '\'!$A$1:$' + colName(s.columns.length - 1) + '$' + (s.rows.length + 1) + '</definedName>').join('') + '</definedNames></workbook>';
  const wbRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    + sheets.map((_, i) => '<Relationship Id="rId' + (i + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + (i + 1) + '.xml"/>').join('')
    + '<Relationship Id="rId' + (sheets.length + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>';
  const styles = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font></fonts>'
    + '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF0F3D2E"/><bgColor indexed="64"/></patternFill></fill></fills>'
    + '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
    + '<cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';
  return zipStored([
    { name: '[Content_Types].xml', data: ct }, { name: '_rels/.rels', data: rels }, { name: 'xl/workbook.xml', data: wb }, { name: 'xl/_rels/workbook.xml.rels', data: wbRels }, { name: 'xl/styles.xml', data: styles },
    ...sheets.map((s, i) => ({ name: 'xl/worksheets/sheet' + (i + 1) + '.xml', data: sheetXml(s) })),
  ]);
}
const COL = (key, title, width) => ({ key, title, width });
/** The four workbook sheets Khaneil asked for (2026-11-23). */
function workbookSheets(c) {
  const k = c.counts;
  const overview = [
    ['Report date', fmtStamp(c.nowMs, c.tz || DEFAULT_TZ)], ['Collected at (UTC)', new Date(c.nowMs).toISOString()], ['Run', c.mode], ['Schedule state', c.scheduleState],
    ['Agents in the catalog', k.agents], ['Agents with run data read', k.read], ['Agents with runs seen', k.withRuns], ['Agents with no workflow linked (no data)', k.noData], ['Agents not connected (source unreadable)', k.notConnected],
    ['Runs seen (all sources, windows below)', k.runs], ['Succeeded', k.succeeded], ['Failed', k.failed], ['Success rate of finished runs', k.successRate == null ? 'No finished runs' : k.successRate + '%'],
    ['Suggestions', k.recs], ['High / medium / low', k.high + ' / ' + k.medium + ' / ' + k.low], ['Agents with stale-data warnings', k.stale],
    ['Sources available', c.sources.filter((s) => s.availability === 'Available').length + ' of ' + c.sources.length],
    ...c.sources.map((s) => ['Window: ' + s.source, s.coverage + ' (' + s.availability + ')']),
    ...(c.failures && c.failures.length ? [['Not completed this cycle', c.failures.join('; ') + ' (retry: run the workflow by hand)']] : []),
  ].map(([item, value]) => ({ item, value }));
  return [
    { name: 'Overview', columns: [COL('item', 'Item', 44), COL('value', 'Value', 70)], rows: overview },
    { name: 'Agent Reports', columns: [COL('agent', 'Agent', 20), COL('role', 'Role', 28), COL('agent_id', 'Agent id', 26), COL('reports_at_et', 'Reports at', 11), COL('catalog_status', 'Catalog status', 13), COL('live_state', 'Live state', 22), COL('data_state', 'Data', 13), COL('window', 'Window', 40),
      COL('runs_seen', 'Runs seen', 30), COL('runs_total', 'Runs', 8), COL('succeeded', 'Succeeded', 10), COL('failed', 'Failed', 8), COL('success_rate', 'Success rate', 13), COL('median_duration', 'Median', 10), COL('longest_duration', 'Longest', 10),
      COL('last_run', 'Last run', 40), COL('last_failure', 'Last failure', 40), COL('scheduled_runs', 'Scheduled', 10), COL('event_runs', 'Event', 8), COL('manual_runs', 'Manual', 8), COL('busiest_hours_et', 'Busiest hours', 26),
      COL('schedules_et', 'Schedules', 40), COL('github_workflows', 'GitHub workflows', 26), COL('n8n_published', 'n8n published', 34), COL('n8n_drafts', 'n8n drafts', 30), COL('memory_service', 'Memory service', 30), COL('atlas_runs', 'Atlas runs', 12), COL('atlas_memory_items', 'Memory items', 12),
      COL('budget', 'Budget / limits', 40), COL('stale_flags', 'Stale-data warnings', 50), COL('recommendations', 'Suggestions', 11)], rows: c.agents },
    { name: 'Workflow Recommendations', columns: [COL('agent', 'Agent', 20), COL('agent_id', 'Agent id', 26), COL('priority', 'Priority', 10), COL('rule', 'Rule', 22), COL('condition', 'Condition', 44), COL('evidence', 'Evidence', 50), COL('suggested_change', 'Suggested change', 60), COL('review_status', 'Review status', 36), COL('last_seen', 'Last seen (UTC)', 24)], rows: c.recs },
    { name: 'Sources', columns: [COL('source', 'Source', 28), COL('holds', 'What it holds', 44), COL('collected_at', 'Collected at (UTC)', 24), COL('coverage', 'Coverage window', 30), COL('retention', 'Retention', 40), COL('availability', 'Availability', 24), COL('note', 'Note', 50)], rows: c.sources },
  ];
}


// ---------------------------------------------------------------- one whole cycle

/**
 * Everything one cycle produces, from the reads: per-agent rows, recommendations, report times, sources,
 * counts. opts: { mode, scheduleState, memory, failures, sheetUrl, slotSource, pick (true: pick report times) }.
 */
function buildCycle(agents, ctx, opts) {
  opts = opts || {};
  const tz = ctx.tz || DEFAULT_TZ, nowIso = new Date(ctx.nowMs).toISOString();
  const first = agents.map((a) => ({ a, r: agentReport(a, ctx) }));
  const picked = opts.pick ? pickSlots(first.map(({ a, r }) => ({ id: a.id, busy: r.busy }))) : {};
  const reports = first.map(({ a, r }) => {
    const slot = a.slot || (picked[a.id] && picked[a.id].slot) || '';
    if (slot !== r.row.reports_at_et) r.row.reports_at_et = slot || 'Not set';
    return { ...r, why: (picked[a.id] && picked[a.id].reason) || (a.slot ? 'Set in catalog/workspace/self-reports.yaml' : 'No report time set') };
  });
  const rows = reports.map((r) => r.row);
  const recs = recRows(reports, nowIso);
  const sources = sourcesOf(ctx, agents, { slotSource: opts.slotSource });
  const counts = countsOf(rows, recs);
  const schedule = reports.map((r) => ({ agent_id: r.row.agent_id, agent: r.row.agent, reports_at_et: r.row.reports_at_et === 'Not set' ? '' : r.row.reports_at_et, why: r.why }))
    .sort((x, y) => (x.reports_at_et || '99').localeCompare(y.reports_at_et || '99') || x.agent.localeCompare(y.agent));
  const conflicts = slotConflicts(Object.fromEntries(schedule.map((s) => [s.agent_id, s.reports_at_et])));
  return { nowMs: ctx.nowMs, tz, stamp: fmtStamp(ctx.nowMs, tz), mode: opts.mode || 'Run by hand', scheduleState: opts.scheduleState || 'Draft: not published in n8n',
    memory: opts.memory || (ctx.atlas.connected ? 'Connected' : ctx.atlas.note), failures: opts.failures || [], sheetUrl: opts.sheetUrl || '', agents: rows, recs, sources, counts, schedule, conflicts };
}
/** Predictable Output Library files for one cycle. */
const FILES = {
  pdf: { outputKey: 'atlas-health-monitor:agent-self-reports-pdf', fileName: 'atlas-agent-self-reports.pdf', mime: 'application/pdf', title: 'Agent self-reports (PDF)' },
  workbook: { outputKey: 'atlas-health-monitor:agent-self-reports-workbook', fileName: 'atlas-agent-self-reports.xlsx', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', title: 'Agent self-reports (Excel workbook)' },
  csv: { outputKey: 'atlas-health-monitor:agent-self-reports-sheet', fileName: 'atlas-agent-self-reports.csv', mime: 'text/csv', title: 'Agent self-reports (table)' },
};

// @export-start (left out when pasted into n8n)
module.exports = { DEFAULT_TZ, NO_DATA, NOT_DOCUMENTED, REVIEW_STATUS, RULES, zonedParts, fmtLocal, fmtDay, fmtStamp, fmtDur, median, hhmm, busyOf, scoreSlot, pickSlots, slotConflicts, cronTimes, n8nSchedules, n8nRun, githubRun, agentReport, sourcesOf, countsOf, recRows, buildPdf, crc32, zipStored, buildXlsx, workbookSheets, buildCycle, FILES };
// @export-end
