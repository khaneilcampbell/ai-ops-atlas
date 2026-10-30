"""Bounded, read-only Atlas improvement evidence; standard library, no AI calls."""
import argparse
import json
import os
import re
import urllib.error
import urllib.request
from pathlib import Path

REPOSITORY = 'khaneilcampbell/ai-ops-atlas'
MAX_FILES = 300
MAX_FILE_BYTES = 128 * 1024
MAX_TOTAL_BYTES = 4 * 1024 * 1024
MAX_FINDINGS = 8


def get_json(endpoint):
    """Only the two fixed evidence endpoint shapes are permitted; no redirects/retries."""
    if not re.fullmatch(r'/actions/runs\?branch=main&event=push&per_page=10|/commits/[0-9a-f]{40}/check-runs\?per_page=30', endpoint):
        raise ValueError('Unsupported evidence endpoint')
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *unused):
            return None
    headers = {'Accept': 'application/vnd.github+json', 'User-Agent': 'Atlas-System-Improvement-Analyst'}
    token = os.environ.get('GH_TOKEN')
    if token:
        headers['Authorization'] = 'Bearer ' + token
    request = urllib.request.Request('https://api.github.com/repos/' + REPOSITORY + endpoint, headers=headers, method='GET')
    try:
        with urllib.request.build_opener(NoRedirect).open(request, timeout=10) as response:
            raw = response.read(1024 * 1024 + 1)
            if len(raw) > 1024 * 1024:
                return None
            value = json.loads(raw)
            return value if isinstance(value, dict) else None
    except (OSError, ValueError, urllib.error.HTTPError):
        return None


def source_findings(root):
    findings, unavailable, hotspots = [], [], []
    used = count = 0
    # Never run repository code or read credentials, logs, node_modules, or user files.
    for path in sorted((root / 'src').rglob('*')):
        if path.suffix not in ('.ts', '.tsx') or path.is_symlink() or not path.is_file():
            continue
        if not path.resolve().is_relative_to(root.resolve()):
            continue
        if path.name.endswith(('.test.ts', '.test.tsx')):
            continue
        if count >= MAX_FILES:
            unavailable.append('Source file limit reached; remaining files were not assessed.')
            break
        count += 1
        size = path.stat().st_size
        if size > MAX_FILE_BYTES:
            unavailable.append(f'{path.relative_to(root)} exceeds the per-file reading limit.')
            continue
        if used + size > MAX_TOTAL_BYTES:
            unavailable.append('Total source reading limit reached; remaining files were not assessed.')
            break
        used += size
        try:
            text = path.read_text(encoding='utf-8', errors='replace')
        except OSError:
            unavailable.append(f'{path.relative_to(root)} could not be read.')
            continue
        relative = path.relative_to(root).as_posix()
        match = re.search(r'<Canvas\b[^>]*\bkey\s*=\s*\{[^}]*(?:\bfloor\b|\ballFloors\b)', text)
        if match:
            line = text[:match.start()].count('\n') + 1
            findings.append({'key': f'canvas:{relative}', 'priority': 'medium', 'evidence': f'{relative}:{line}',
                             'recommendation': 'Review floor-dependent Canvas keys: keep the renderer alive and move the camera when switching floor views. Confirm with repeated-switch browser checks.'})
        lines = text.count('\n') + 1
        if lines > 500:
            hotspots.append((lines, relative))
    if not count:
        unavailable.append('No source files were assessed.')
    for lines, relative in sorted(hotspots, reverse=True)[:3]:
        findings.append({'key': f'complexity:{relative}', 'priority': 'low', 'evidence': f'{relative}: {lines} lines',
                         'recommendation': 'Candidate for a small module extraction when next edited; preserve behavior and cover the affected flow. File length alone is not a defect.'})
    return findings, unavailable, {'files': count, 'bytes': used}


def ci_findings(runs, checks, sha):
    findings, unavailable = [], []
    if not isinstance(runs, dict) or not isinstance(runs.get('workflow_runs'), list):
        unavailable.append('Recent main-branch workflow evidence unavailable.')
    else:
        latest = {}
        for run in sorted((r for r in runs['workflow_runs'][:10] if isinstance(r, dict)), key=lambda r: (str(r.get('created_at', '')), r.get('id') if isinstance(r.get('id'), int) else 0), reverse=True):
            if run.get('head_branch') != 'main' or run.get('event') != 'push':
                continue
            path = run.get('path')
            if not path or path == '.github/workflows/system-improvements.yml':
                continue
            latest.setdefault(path, run)
        if not latest:
            unavailable.append('No main-branch push workflows in the bounded sample.')
        for path, run in latest.items():
            run_id = run.get('id')
            if not isinstance(run_id, int):
                continue
            evidence = f'https://github.com/{REPOSITORY}/actions/runs/{run_id}'
            if run.get('status') != 'completed':
                unavailable.append(f'Workflow run {run_id} is unfinished; its result is unknown.')
            elif run.get('conclusion') in ('failure', 'timed_out', 'action_required', 'startup_failure'):
                findings.append({'key': f'ci:{path}', 'priority': 'high', 'evidence': evidence,
                                 'recommendation': 'Review the latest sampled main-branch failure and fix its cause with a targeted regression check. Do not hide the failure or retry without evidence.'})
            elif run.get('conclusion') != 'success':
                unavailable.append(f'Workflow run {run_id} did not produce a successful result.')
    if not isinstance(checks, dict) or not isinstance(checks.get('check_runs'), list):
        unavailable.append(f'Check results for commit {sha} unavailable.')
    else:
        sampled = [c for c in checks['check_runs'][:30] if isinstance(c, dict)]
        if not sampled:
            unavailable.append(f'No checks observed for commit {sha}.')
        if checks.get('total_count', len(sampled)) > 30:
            unavailable.append('Only the first 30 commit checks were assessed.')
        unfinished = sum(c.get('status') != 'completed' for c in sampled)
        if unfinished:
            unavailable.append(f'{unfinished} commit checks remain unfinished; rerun manually after they finish if needed.')
        failures = sum(c.get('status') == 'completed' and c.get('conclusion') in ('failure', 'timed_out', 'action_required', 'startup_failure') for c in sampled)
        if failures:
            findings.append({'key': 'commit-checks', 'priority': 'high',
                             'evidence': f'https://github.com/{REPOSITORY}/commit/{sha}/checks',
                             'recommendation': f'Review {failures} unsuccessful checks on the assessed commit before shipping further changes.'})
    return findings, unavailable


def collect(root, sha, fetch=get_json, offline=False):
    if not re.fullmatch('[0-9a-f]{40}', sha):
        raise ValueError('An exact 40-character commit SHA is required')
    findings, unavailable, coverage = source_findings(root)
    if offline:
        unavailable.append('Offline report: GitHub evidence was not requested.')
    else:
        ci, missing = ci_findings(fetch('/actions/runs?branch=main&event=push&per_page=10'), fetch(f'/commits/{sha}/check-runs?per_page=30'), sha)
        findings.extend(ci)
        unavailable.extend(missing)
    findings.sort(key=lambda f: ({'high': 0, 'medium': 1, 'low': 2}[f['priority']], f['key']))
    return {'repository': REPOSITORY, 'commit': sha, 'mode': 'reports-only', 'model_calls': 0,
            'github_requests': 0 if offline else 2, 'coverage': coverage, 'findings': findings[:MAX_FINDINGS],
            'omitted_findings': max(0, len(findings) - MAX_FINDINGS), 'unavailable': unavailable,
            'limitations': ['A bounded improvement scan, not a security audit or proof of UI correctness.',
                            'No new tests, builds, browser sessions, dependency installs, or code changes were executed.',
                            'Workflow evidence samples at most 10 recent main pushes; it is not a complete history.',
                            'GitHub runner usage is subject to the account plan; model usage is zero.']}


def markdown(report):
    lines = ['# Atlas system improvement report', '', f"Commit: `{report['commit']}`", '',
             'Reports only · 0 model calls · No repository writes', '',
             f"Coverage: {report['coverage']['files']} source files; {report['github_requests']} bounded GitHub requests.", '', '## Improvement candidates', '']
    if not report['findings']:
        lines.append('No candidates found by these limited rules. This does not establish that the system is error-free.')
    for finding in report['findings']:
        lines.extend([f"- **{finding['priority'].title()}** — {finding['recommendation']}", f"  Evidence: `{finding['evidence']}`"])
    if report['omitted_findings']:
        lines.append(f"{report['omitted_findings']} additional candidates omitted by the report limit.")
    lines += ['', '## Unavailable evidence', '']
    lines += ['- ' + item for item in report['unavailable']] or ['- None within the stated sampling limits.']
    lines += ['', '## Limits', ''] + ['- ' + item for item in report['limitations']]
    return '\n'.join(lines) + '\n'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--sha', required=True)
    parser.add_argument('--output', required=True)
    parser.add_argument('--offline', action='store_true')
    args = parser.parse_args()
    report = collect(Path(__file__).resolve().parents[2], args.sha, offline=args.offline)
    output = Path(args.output)
    output.mkdir(parents=True, exist_ok=True)
    (output / 'report.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
    (output / 'report.md').write_text(markdown(report), encoding='utf-8')
    # Print the summary only, never API response bodies or credentials.
    print(markdown(report))


if __name__ == '__main__':
    main()
