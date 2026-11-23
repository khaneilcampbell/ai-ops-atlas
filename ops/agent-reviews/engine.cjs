// Agent reviews: the plain-code engines behind two n8n workflows (no AI, no network calls here).
//   scorecard()  Margaret Lindqvist (atlas-engineering-review): weekly engineering scorecard across
//                every catalog repository (CI, dependencies, security settings) and agent autonomy.
//   repoHealth() Samuel Asante (repo-intelligence): weekly delivery health of each repository
//                (activity, pull requests, issues, releases, CI), verified facts kept apart from suggestions.
// The n8n Code nodes are generated from this file (node ops/agent-reviews/build-n8n.mjs), so the
// tests here run the same code n8n runs. Anything that could not be read stays "Not read": it never
// counts as a pass and never as zero.
const DAY = 86400000;
const NOT_READ = 'Not read';
const SEV = { critical: 4, high: 3, medium: 2, low: 1 };
const PRIORITY = { High: 0, Medium: 1, Low: 2 };
const REVIEW = 'Suggestion only: nothing was changed';

const days = (from, to) => Math.floor((to - Date.parse(from)) / DAY);
const plural = (n, w) => n + ' ' + w + (n === 1 ? '' : 's');
const fmtDay = (iso) => (iso ? new Date(iso).toISOString().slice(0, 10) : '');
const ok = (src) => src && src.ok;
const why = (src) => (src && src.error) || NOT_READ;

// A source is { ok: true, ...data } or { ok: false, error: 'HTTP 404' }.
// Margaret's rules, in the order they are checked. Each names what it looks at, so every finding can be traced.
const SCORE_RULES = [
  { id: 'ci-failing', points: 25, priority: 'High', condition: 'The latest finished CI run on the default branch failed' },
  { id: 'ci-flaky', points: 10, priority: 'Medium', condition: 'Under 80% of finished default-branch CI runs in the last 7 days succeeded' },
  { id: 'critical-alerts', points: 25, priority: 'High', condition: 'Open Dependabot or code scanning alerts of high or critical severity' },
  { id: 'open-alerts', points: 8, priority: 'Medium', condition: 'Open Dependabot or code scanning alerts of medium or low severity' },
  { id: 'secret-alerts', points: 30, priority: 'High', condition: 'Open secret scanning alerts' },
  { id: 'no-protection', points: 15, priority: 'Medium', condition: 'The default branch has no branch protection or ruleset' },
  { id: 'code-scanning-off', points: 5, priority: 'Low', condition: 'Code scanning is not set up' },
  { id: 'stale-dependency-prs', points: 5, priority: 'Low', condition: 'Dependabot pull requests open for more than 14 days' },
  { id: 'not-read', points: 0, priority: 'Medium', condition: 'A GitHub source could not be read, so that part is unknown (not scored as a pass)' },
];
const AGENT_RULES = [
  { id: 'high-autonomy-no-approval', priority: 'High', condition: 'Autonomy 3 or higher with no approval step written in the catalog' },
  { id: 'autonomy-missing', priority: 'Low', condition: 'Active agent with no autonomy level in the catalog' },
];
const ruleOf = (list, id) => list.find((r) => r.id === id);
const grade = (score) => (score >= 90 ? 'A' : score >= 80 ? 'B' : score >= 65 ? 'C' : score >= 50 ? 'D' : 'F');

function scoreRepo(r, now) {
  const found = [];
  const add = (id, evidence, change) => { const rule = ruleOf(SCORE_RULES, id); found.push({ rule: id, condition: rule.condition, priority: rule.priority, points: rule.points, evidence, change }); };
  const unread = [];
  let ciLast = NOT_READ, ciRate = NOT_READ;
  if (ok(r.ci)) {
    const fin = r.ci.runs.filter((x) => x.status === 'completed' && ['success', 'failure', 'timed_out', 'startup_failure'].includes(x.conclusion));
    const week = fin.filter((x) => now - Date.parse(x.created_at) < 7 * DAY);
    const last = fin[0];
    ciLast = last ? last.conclusion + ' (' + fmtDay(last.created_at) + ')' : 'No finished runs';
    if (week.length) { const pass = week.filter((x) => x.conclusion === 'success').length; ciRate = Math.round((pass / week.length) * 100) + '% of ' + week.length; if (pass / week.length < 0.8) add('ci-flaky', ciRate + ' default-branch runs succeeded in 7 days', 'Look at the failing jobs in the last week and fix or quarantine the flaky step.'); }
    else ciRate = 'No runs in 7 days';
    if (last && last.conclusion !== 'success') add('ci-failing', 'Latest run ' + last.conclusion + ' on ' + fmtDay(last.created_at) + (last.name ? ' (' + last.name + ')' : ''), 'Fix the default branch build before merging anything else.');
  } else unread.push('CI: ' + why(r.ci));
  const alerts = [];
  if (ok(r.dependabot)) alerts.push(...r.dependabot.alerts.map((a) => ({ sev: a.severity, src: 'Dependabot' }))); else unread.push('Dependabot alerts: ' + why(r.dependabot));
  let codeScanning = NOT_READ;
  if (ok(r.codeScanning)) { codeScanning = r.codeScanning.enabled ? plural(r.codeScanning.alerts.length, 'open alert') : 'Not set up'; alerts.push(...r.codeScanning.alerts.map((a) => ({ sev: a.severity, src: 'Code scanning' }))); if (!r.codeScanning.enabled) add('code-scanning-off', 'GitHub reports no code scanning analysis', 'Turn on CodeQL default setup for this repository.'); }
  else unread.push('Code scanning: ' + why(r.codeScanning));
  const hi = alerts.filter((a) => (SEV[a.sev] || 0) >= 3), lo = alerts.filter((a) => (SEV[a.sev] || 0) < 3);
  if (hi.length) add('critical-alerts', plural(hi.length, 'high or critical alert') + ' (' + [...new Set(hi.map((a) => a.src))].join(', ') + ')', 'Patch or dismiss with a reason the high and critical alerts first.');
  if (lo.length) add('open-alerts', plural(lo.length, 'medium or low alert'), 'Batch the remaining alerts into one dependency update.');
  let secrets = NOT_READ;
  if (ok(r.secretScanning)) { secrets = r.secretScanning.enabled ? plural(r.secretScanning.alerts.length, 'open alert') : 'Not set up'; if (r.secretScanning.alerts.length) add('secret-alerts', plural(r.secretScanning.alerts.length, 'open secret alert'), 'Rotate the exposed secret, then close the alert.'); }
  else unread.push('Secret scanning: ' + why(r.secretScanning));
  let protection = NOT_READ;
  if (ok(r.protection)) { protection = r.protection.protected ? (r.protection.detail || 'Protected') : 'None'; if (!r.protection.protected) add('no-protection', 'No branch protection or ruleset on ' + (r.defaultBranch || 'the default branch'), 'Add a ruleset that requires the CI check before merging.'); }
  else unread.push('Branch protection: ' + why(r.protection));
  let depPrs = NOT_READ;
  if (ok(r.dependencyPrs)) { const old = r.dependencyPrs.prs.filter((p) => days(p.created_at, now) > 14); depPrs = plural(r.dependencyPrs.prs.length, 'open') + (old.length ? ', ' + old.length + ' over 14 days' : ''); if (old.length) add('stale-dependency-prs', plural(old.length, 'Dependabot pull request') + ' open over 14 days (oldest ' + Math.max(...old.map((p) => days(p.created_at, now))) + ' days)', 'Merge or close the old Dependabot pull requests.'); }
  else unread.push('Dependabot pull requests: ' + why(r.dependencyPrs));
  if (unread.length) add('not-read', unread.join('; '), 'Check the GitHub credential can read this, so the score covers everything.');
  const read = 6 - unread.length;
  const score = read ? Math.max(0, 100 - found.reduce((s, f) => s + f.points, 0)) : null;
  return {
    row: { repo: r.repo, project: r.project || '', score: score == null ? '' : score, grade: score == null ? NOT_READ : grade(score) + (unread.length ? ' (partial)' : ''),
      ci_latest: ciLast, ci_7_days: ciRate, open_alerts: ok(r.dependabot) || ok(r.codeScanning) ? alerts.length : NOT_READ, high_critical: ok(r.dependabot) || ok(r.codeScanning) ? hi.length : NOT_READ,
      code_scanning: codeScanning, secret_scanning: secrets, branch_protection: protection, dependency_prs: depPrs, not_read: unread.join('; ') || 'None', findings: found.length },
    findings: found.map((f) => ({ ...f, subject: r.repo })),
  };
}

function scoreAgents(agents) {
  const out = [];
  for (const a of agents) {
    const add = (id, evidence, change) => { const rule = ruleOf(AGENT_RULES, id); out.push({ subject: a.name + ' (' + a.id + ')', rule: id, condition: rule.condition, priority: rule.priority, points: 0, evidence, change }); };
    if (a.autonomy == null || a.autonomy === '') { if (a.status === 'active') add('autonomy-missing', 'No registry.governance.autonomy for ' + a.id, 'Write the autonomy level and what it may do alone in the catalog.'); continue; }
    if (Number(a.autonomy) >= 3 && !a.approval) add('high-autonomy-no-approval', 'Autonomy ' + a.autonomy + ', no approval or human_in_loop text', 'Write who approves its actions, or lower its autonomy.');
  }
  return out;
}

function scorecard(repos, agents, nowMs) {
  const reports = repos.map((r) => scoreRepo(r, nowMs));
  const agentFindings = scoreAgents(agents || []);
  const findings = [...reports.flatMap((x) => x.findings), ...agentFindings].sort((a, b) => PRIORITY[a.priority] - PRIORITY[b.priority] || b.points - a.points);
  const scored = reports.map((x) => x.row).filter((r) => r.score !== '');
  const autonomy = {}; for (const a of agents || []) { const k = a.autonomy == null || a.autonomy === '' ? 'Not set' : 'Level ' + a.autonomy; autonomy[k] = (autonomy[k] || 0) + 1; }
  return {
    rows: reports.map((x) => x.row).sort((a, b) => (a.score === '' ? 999 : a.score) - (b.score === '' ? 999 : b.score)),
    findings: findings.map((f, i) => ({ rank: i + 1, ...f, review_status: REVIEW })),
    summary: { repos: repos.length, scored: scored.length, average: scored.length ? Math.round(scored.reduce((s, r) => s + r.score, 0) / scored.length) : null,
      high: findings.filter((f) => f.priority === 'High').length, medium: findings.filter((f) => f.priority === 'Medium').length, low: findings.filter((f) => f.priority === 'Low').length,
      agents: (agents || []).length, autonomy },
  };
}

// Samuel's repository health: facts first, then suggestions tied to a fact.
const HEALTH_RULES = [
  { id: 'ci-red', priority: 'High', condition: 'The latest finished default-branch CI run failed' },
  { id: 'stale-prs', priority: 'Medium', condition: 'Open, non-draft pull requests with no update in 14 days' },
  { id: 'quiet-repo', priority: 'Low', condition: 'Active project with no commit on the default branch in 30 days' },
  { id: 'issue-backlog', priority: 'Low', condition: 'More than 20 open issues' },
  { id: 'no-release', priority: 'Low', condition: 'No GitHub release in 90 days while commits landed (only when the repo has published releases before)' },
  { id: 'not-read', priority: 'Medium', condition: 'A GitHub source could not be read, so that fact is unknown' },
];

function healthRepo(r, now) {
  const facts = { repo: r.repo, project: r.project || '' }, sugg = [], unread = [];
  const add = (id, evidence, change) => { const rule = ruleOf(HEALTH_RULES, id); sugg.push({ subject: r.repo, rule: id, condition: rule.condition, priority: rule.priority, evidence, change }); };
  let commits = null;
  if (ok(r.repoInfo)) { facts.default_branch = r.repoInfo.default_branch; facts.last_push = fmtDay(r.repoInfo.pushed_at); facts.archived = r.repoInfo.archived ? 'Yes' : 'No'; }
  else { unread.push('Repository: ' + why(r.repoInfo)); facts.default_branch = NOT_READ; facts.last_push = NOT_READ; facts.archived = NOT_READ; }
  if (ok(r.commits)) { commits = r.commits.count; facts.commits_30_days = r.commits.count + (r.commits.truncated ? '+ (first 100 read)' : ''); facts.last_commit = fmtDay(r.commits.latest) || 'None in 30 days'; }
  else { unread.push('Commits: ' + why(r.commits)); facts.commits_30_days = NOT_READ; facts.last_commit = NOT_READ; }
  if (ok(r.pulls)) {
    const open = r.pulls.open, stale = open.filter((p) => !p.draft && days(p.updated_at, now) > 14);
    facts.open_prs = open.length; facts.draft_prs = open.filter((p) => p.draft).length; facts.stale_prs = stale.length;
    facts.oldest_open_pr_days = open.length ? Math.max(...open.map((p) => days(p.created_at, now))) : 'None open';
    facts.merged_30_days = r.pulls.merged30 == null ? NOT_READ : r.pulls.merged30;
    if (stale.length) add('stale-prs', plural(stale.length, 'open pull request') + ' untouched for 14+ days: ' + stale.slice(0, 3).map((p) => '#' + p.number).join(', '), 'Merge, update or close them so the queue reflects real work.');
  } else { unread.push('Pull requests: ' + why(r.pulls)); facts.open_prs = NOT_READ; facts.draft_prs = NOT_READ; facts.stale_prs = NOT_READ; facts.oldest_open_pr_days = NOT_READ; facts.merged_30_days = NOT_READ; }
  if (ok(r.repoInfo) && ok(r.pulls)) { facts.open_issues = Math.max(0, (r.repoInfo.open_issues_count || 0) - r.pulls.open.length); if (facts.open_issues > 20) add('issue-backlog', facts.open_issues + ' open issues', 'Close stale issues or label the ones still wanted.'); }
  else facts.open_issues = NOT_READ;
  if (ok(r.release)) { facts.latest_release = r.release.latest ? fmtDay(r.release.latest) : 'None published';
    if (r.release.latest && days(r.release.latest, now) > 90 && commits) add('no-release', 'Last release ' + fmtDay(r.release.latest) + ', ' + commits + ' commits in the last 30 days', 'Cut a release so the changes are versioned.'); }
  else { unread.push('Releases: ' + why(r.release)); facts.latest_release = NOT_READ; }
  if (ok(r.ci)) { const last = r.ci.runs.find((x) => x.status === 'completed' && x.conclusion !== 'skipped' && x.conclusion !== 'cancelled'); facts.ci_latest = last ? last.conclusion + ' (' + fmtDay(last.created_at) + ')' : 'No finished runs';
    if (last && last.conclusion !== 'success') add('ci-red', 'Latest run ' + last.conclusion + ' on ' + fmtDay(last.created_at), 'Fix the default branch build first.'); }
  else { unread.push('CI: ' + why(r.ci)); facts.ci_latest = NOT_READ; }
  if (commits === 0 && r.status !== 'archived' && facts.archived !== 'Yes') add('quiet-repo', 'No commits in 30 days (last push ' + (facts.last_push || NOT_READ) + ')', 'Archive it in the catalog if it is finished, or note why it is paused.');
  if (unread.length) add('not-read', unread.join('; '), 'Check the GitHub credential can read this repository.');
  facts.not_read = unread.join('; ') || 'None';
  facts.suggestions = sugg.length;
  return { facts, suggestions: sugg };
}

function repoHealth(repos, nowMs) {
  const list = repos.map((r) => healthRepo(r, nowMs));
  const suggestions = list.flatMap((x) => x.suggestions).sort((a, b) => PRIORITY[a.priority] - PRIORITY[b.priority]);
  const facts = list.map((x) => x.facts);
  const num = (k) => facts.reduce((s, f) => s + (typeof f[k] === 'number' ? f[k] : 0), 0);
  return { facts, suggestions: suggestions.map((s, i) => ({ rank: i + 1, ...s, review_status: REVIEW })),
    summary: { repos: repos.length, read: facts.filter((f) => f.not_read === 'None').length, openPrs: num('open_prs'), stalePrs: num('stale_prs'), merged30: num('merged_30_days'),
      high: suggestions.filter((s) => s.priority === 'High').length, medium: suggestions.filter((s) => s.priority === 'Medium').length, low: suggestions.filter((s) => s.priority === 'Low').length } };
}

// Outputs: a Markdown report (rendered in the Output Library) and a CSV table.
const md = (s) => String(s == null ? '' : s).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
function table(cols, rows) { return '| ' + cols.map((c) => c[1]).join(' | ') + ' |\n|' + cols.map(() => '---').join('|') + '|\n' + rows.map((r) => '| ' + cols.map((c) => md(r[c[0]])).join(' | ') + ' |').join('\n') + '\n'; }
function csv(cols, rows) { const esc = (v) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }; return [cols.map((c) => c[1]).join(','), ...rows.map((r) => cols.map((c) => esc(r[c[0]])).join(','))].join('\n') + '\n'; }

const SCORE_COLS = [['repo', 'Repository'], ['grade', 'Grade'], ['score', 'Score'], ['ci_latest', 'Latest CI'], ['ci_7_days', 'CI, 7 days'], ['high_critical', 'High/critical alerts'], ['open_alerts', 'All open alerts'], ['secret_scanning', 'Secret scanning'], ['code_scanning', 'Code scanning'], ['branch_protection', 'Branch protection'], ['dependency_prs', 'Dependabot PRs'], ['not_read', 'Not read']];
const FIND_COLS = [['rank', '#'], ['priority', 'Priority'], ['subject', 'Where'], ['evidence', 'Evidence'], ['change', 'Suggested change'], ['condition', 'Rule'], ['review_status', 'Review status']];
function scorecardMarkdown(c, meta) {
  const s = c.summary;
  return '# Weekly engineering scorecard\n\n' + 'Margaret Lindqvist, Senior Engineering Reviewer · ' + meta.stamp + ' · ' + meta.mode + '\n\n'
    + '**' + s.scored + ' of ' + s.repos + ' repositories scored**, average ' + (s.average == null ? NOT_READ : s.average + '/100') + '. '
    + s.high + ' high, ' + s.medium + ' medium and ' + s.low + ' low findings. ' + s.agents + ' agents checked for autonomy (' + Object.entries(s.autonomy).map(([k, v]) => k + ': ' + v).join(', ') + ').\n\n'
    + 'Plain rules, no AI. Each finding names its rule and evidence. Nothing was changed. Anything GitHub did not answer is listed as "Not read" and is not scored as a pass.\n\n'
    + '## Scorecard\n\n' + table(SCORE_COLS, c.rows) + '\n## Ranked findings\n\n' + (c.findings.length ? table(FIND_COLS, c.findings) : 'No rule matched.\n')
    + '\n## How the score works\n\nEach repository starts at 100 and loses points per rule: ' + SCORE_RULES.filter((r) => r.points).map((r) => r.condition + ' (-' + r.points + ')').join('; ') + '. Grades: A 90+, B 80+, C 65+, D 50+, F below 50.\n';
}
const FACT_COLS = [['repo', 'Repository'], ['last_commit', 'Last commit'], ['commits_30_days', 'Commits, 30 days'], ['merged_30_days', 'PRs merged, 30 days'], ['open_prs', 'Open PRs'], ['stale_prs', 'Stale PRs'], ['oldest_open_pr_days', 'Oldest PR (days)'], ['open_issues', 'Open issues'], ['latest_release', 'Latest release'], ['ci_latest', 'Latest CI'], ['not_read', 'Not read']];
function healthMarkdown(h, meta) {
  const s = h.summary;
  return '# Weekly repository health\n\n' + 'Samuel Asante, Repository Intelligence · ' + meta.stamp + ' · ' + meta.mode + '\n\n'
    + '**' + s.repos + ' repositories**, ' + s.read + ' fully read. ' + s.openPrs + ' open pull requests (' + s.stalePrs + ' stale), ' + s.merged30 + ' merged in 30 days. '
    + s.high + ' high, ' + s.medium + ' medium and ' + s.low + ' low suggestions.\n\n'
    + 'Verified facts come first and are read straight from GitHub. Suggestions follow, each tied to a fact and a written rule. No AI, nothing changed.\n\n'
    + '## Verified facts\n\n' + table(FACT_COLS, h.facts) + '\n## Suggestions\n\n' + (h.suggestions.length ? table(FIND_COLS, h.suggestions) : 'No rule matched.\n');
}

const FILES = {
  scorecard: { agent: 'atlas-engineering-review', md: { outputKey: 'atlas-engineering-review:weekly-scorecard', id: 'engineering-scorecard.md', title: 'Weekly engineering scorecard' }, csv: { outputKey: 'atlas-engineering-review:weekly-scorecard-table', id: 'engineering-scorecard.csv', title: 'Weekly engineering scorecard (table)' } },
  health: { agent: 'repo-intelligence', md: { outputKey: 'repo-intelligence:weekly-repo-health', id: 'repo-health.md', title: 'Weekly repository health' }, csv: { outputKey: 'repo-intelligence:weekly-repo-health-table', id: 'repo-health.csv', title: 'Weekly repository health (table)' } },
};

// @export-start
module.exports = { scorecard, repoHealth, scorecardMarkdown, healthMarkdown, csv, SCORE_COLS, FIND_COLS, FACT_COLS, SCORE_RULES, AGENT_RULES, HEALTH_RULES, FILES, NOT_READ, REVIEW };
// @export-end
