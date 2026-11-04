"""Manual, model-free reliability reports. Read GitHub evidence; write local output only."""
import argparse
import hashlib
import json
import os
import re
import subprocess
from datetime import datetime, timezone
from pathlib import Path

from report import REPOSITORY, ci_findings, get_json

AGENT = 'atlas-reliability-reviewer'


def gh_json(endpoint):
    """Optional local transport using the existing authenticated GitHub CLI; never a shell."""
    if not re.fullmatch(r'/actions/runs\?branch=main&event=push&per_page=10|/commits/[0-9a-f]{40}/check-runs\?per_page=30', endpoint):
        raise ValueError('Unsupported evidence endpoint')
    try:
        result = subprocess.run(['gh', 'api', f'repos/{REPOSITORY}{endpoint}'],
                                capture_output=True, timeout=10, check=True)
        if len(result.stdout) > 1024 * 1024:
            return None
        data = json.loads(result.stdout)
        return data if isinstance(data, dict) else None
    except (OSError, ValueError, subprocess.SubprocessError):
        return None


def run(sha, output, state=None, fetch=get_json, stopped=False):
    if not re.fullmatch('[0-9a-f]{40}', sha):
        raise ValueError('An exact lowercase commit SHA is required')
    output = Path(output)
    output.mkdir(parents=True, exist_ok=True)
    now = datetime.now(timezone.utc).isoformat()
    report = dict(agent_id=AGENT, repository=REPOSITORY, commit=sha,
                  observed_at=now, model_calls=0, evidence_url=f'https://github.com/{REPOSITORY}/commit/{sha}/checks', findings=[], unavailable=[])
    if stopped:
        report.update(status='stopped', task='Reporting disabled by stop control', next_action='Review the stop control before another manual run.')
    else:
        try:
            runs = fetch('/actions/runs?branch=main&event=push&per_page=10')
            checks = fetch(f'/commits/{sha}/check-runs?per_page=30')
            findings, missing = ci_findings(runs, checks, sha)
        except (OSError, TimeoutError, ValueError):
            findings, missing = [], ['Evidence collection failed or timed out; no successful verification claimed.']
        # Hash bounded normalized evidence, excluding refresh time and unrelated response fields.
        payload = dict(commit=sha, findings=findings, unavailable=missing)
        fingerprint = hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()
        previous = None
        if state and Path(state).exists():
            try:
                previous = json.loads(Path(state).read_text()).get('fingerprint')
            except (OSError, ValueError, AttributeError):
                pass  # Corrupt cache is a miss, never grounds to suppress a report.
        report.update(status='incomplete' if missing else 'unchanged' if previous == fingerprint else 'succeeded',
                      task='Review bounded main-branch CI evidence', findings=findings[:3], unavailable=missing,
                      fingerprint=fingerprint, changed=previous != fingerprint,
                      next_action='Review linked failures; authorize any code or production change separately.' if findings else 'No failures found in the bounded sample; unavailable evidence remains unknown.' if missing else 'No failures found in the bounded sample. No production action taken.')
        # Only complete reports advance dedup state. Failed reads can be retried manually.
        if state and not missing and previous != fingerprint:
            path = Path(state)
            path.parent.mkdir(parents=True, exist_ok=True)
            tmp = path.with_suffix('.tmp')
            tmp.write_text(json.dumps({'fingerprint': fingerprint, 'observed_at': now}) + '\n')
            tmp.replace(path)
    lines = ['# Atlas reliability report', '', f"Agent: {AGENT}", f"Result: {report['status']}",
             f'Commit: {sha}', f'Last checked: {now}', report['evidence_url'], '',
             'Source: GitHub Actions REST evidence · Read-only · 0 model calls', '', report['task'], '']
    if report.get('status') == 'unchanged':
        lines.append('Evidence unchanged; no new findings generated. Previous findings are retained below for review.')
    for f in report['findings']:
        lines += [f"- {f['recommendation']}", f"  Evidence: {f['evidence']}"]
    lines += ['', 'Unavailable evidence:'] + ['- ' + m for m in report['unavailable']]
    lines += ['', report['next_action'], '', 'Limits: 10 recent main push runs, 30 commit checks, at most 3 recommendations. A successful report can contain failed checks; it does not certify production health. No jobs are rerun or changed.']
    (output / 'report.json').write_text(json.dumps(report, indent=2) + '\n')
    (output / 'report.md').write_text('\n'.join(lines) + '\n')
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--sha', required=True)
    parser.add_argument('--output', required=True)
    parser.add_argument('--state')
    parser.add_argument('--transport', choices=('https', 'gh'), default='https')
    args = parser.parse_args()
    stop = os.environ.get('ATLAS_RELIABILITY_STOP', 'false').lower()
    if stop not in ('true', 'false'):
        raise ValueError('Stop control must be true or false')
    report = run(args.sha, args.output, args.state, fetch=gh_json if args.transport == 'gh' else get_json, stopped=stop == 'true')
    github_output = os.environ.get('GITHUB_OUTPUT')
    if github_output:
        with open(github_output, 'a') as stream:
            stream.write(f"changed={str(report['status'] == 'succeeded').lower()}\n")
    print(f"Reliability report: {report['status']} · 0 model calls")
    if report['status'] == 'incomplete':
        raise SystemExit(1)


if __name__ == '__main__':
    main()
