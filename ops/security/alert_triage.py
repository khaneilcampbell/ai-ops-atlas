"""B4: manual model-free alert triage, reusing the existing GET-only Steward collector."""
import argparse
import hashlib
import importlib.util
import json
import os
from datetime import datetime, timezone
from pathlib import Path

_SPEC = importlib.util.spec_from_file_location('steward_collect', Path(__file__).resolve().parents[1] / 'github-steward' / 'collect.py')
_MODULE = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(_MODULE)
collect = _MODULE.collect
POLICY = Path(__file__).with_name('alert-triage-policy.json')
SEVERITIES = {'critical': 0, 'high': 1, 'medium': 2, 'moderate': 2, 'low': 3, 'unknown': 4}


def triage(evidence):
    alerts, unknown = [], []
    allowlist = set(json.loads(POLICY.read_text())['repositories'])
    if not isinstance(evidence, dict) or not isinstance(evidence.get('repositories'), list):
        raise ValueError('Invalid evidence')
    seen = set()
    for repo in evidence['repositories']:
        if not isinstance(repo, dict):
            raise ValueError('Invalid repository evidence')
        name = repo.get('repository')
        if name not in allowlist:
            raise ValueError('Repository outside B4 allowlist')
        seen.add(name)
        for key, url in [('dependabot_alerts', 'dependabot'), ('code_scanning_alerts', 'code-scanning')]:
            source = repo.get(key, {})
            if not isinstance(source, dict):
                source = {}
            data = source.get('data')
            if source.get('status') != 'observed' or not isinstance(data, list):
                unknown.append(f'{name}: {key} unavailable; access or API availability is unverified.')
                continue
            if len(data) >= 20:
                unknown.append(f'{name}: {key} first-page limit reached; additional alerts may exist.')
            for item in data[:20]:
                if not isinstance(item, dict) or not isinstance(item.get('number'), int) or isinstance(item.get('number'), bool) or item['number'] < 1 or item.get('state') != 'open':
                    unknown.append(f'{name}: {key} record could not be verified as an open alert.')
                    continue
                advisory = item.get('security_advisory') or {}
                rule = item.get('rule') or {}
                advisory = advisory if isinstance(advisory, dict) else {}
                rule = rule if isinstance(rule, dict) else {}
                severity = advisory.get('severity') if key == 'dependabot_alerts' else rule.get('security_severity_level')
                severity = severity if severity in SEVERITIES else 'unknown'
                alerts.append({'repository': name, 'source': key, 'number': item['number'], 'severity': severity,
                               'evidence': f'https://github.com/{name}/security/{url}/{item["number"]}',
                               'next_action': 'Review the advisory and compatible fixed version before preparing a tested dependency PR.' if url == 'dependabot' else 'Review the reported code path and reproduce the finding before preparing a tested fix PR.'})
    unknown.extend(f'{name}: repository evidence missing.' for name in allowlist - seen)
    alerts.sort(key=lambda a: (SEVERITIES[a['severity']], a['repository'], a['source'], a['number']))
    # Repeat API records never produce duplicate proposals.
    unique = {(a['repository'], a['source'], a['number']): a for a in alerts}
    return list(unique.values()), sorted(set(unknown))


def run(output, state=None, collector=collect, stopped=False):
    now = datetime.now(timezone.utc).isoformat()
    report = {'agent_id': 'service-desk-codeql', 'capability': 'B4 Security Alert Triage',
              'observed_at': now, 'model_calls': 0, 'status': 'stopped' if stopped else 'incomplete', 'alerts': [], 'unavailable': []}
    if not stopped:
        try:
            evidence = collector(POLICY)
            alerts, unknown = triage(evidence)
            fingerprint = hashlib.sha256(json.dumps([alerts, unknown], sort_keys=True).encode()).hexdigest()
            previous = None
            if state and Path(state).exists():
                try:
                    previous = json.loads(Path(state).read_text()).get('fingerprint')
                except (OSError, ValueError, AttributeError):
                    pass
            report.update(alerts=alerts, unavailable=unknown, fingerprint=fingerprint,
                          status='incomplete' if unknown else 'unchanged' if previous == fingerprint else 'succeeded')
            if state and report['status'] == 'succeeded':
                target = Path(state)
                target.parent.mkdir(parents=True, exist_ok=True)
                temp = target.with_suffix('.tmp')
                temp.write_text(json.dumps({'fingerprint': fingerprint}))
                temp.replace(target)
        except (OSError, ValueError, KeyError, TypeError):
            report['unavailable'] = ['Collection stopped, failed, or exceeded its budget; alert coverage remains unknown.']
    report['approval'] = 'No alerts dismissed, code changed, PRs created, or production actions performed. Any fix PR must be independently tested and reviewed before you merge.'
    output = Path(output)
    output.mkdir(parents=True, exist_ok=True)
    (output / 'report.json').write_text(json.dumps(report, indent=2) + '\n')
    lines = ['# B4 Security Alert Triage', '', f"Result: {report['status']}", f'Last checked: {now}', 'Read-only GitHub evidence · 0 model calls', '']
    lines += [f"- {a['severity'].upper()}: {a['repository']} #{a['number']} — {a['evidence']}\n  {a['next_action']}" for a in report['alerts']]
    if not report['alerts']:
        lines += ['No open alerts observed in the available sample. Unavailable data is not evidence of protection or absence of vulnerabilities.']
    lines += ['', *report['unavailable'], '', report['approval'], 'Coverage: first 20 open Dependabot and code-scanning alerts per allowlisted repository. No secret-scanning, live Splunk, production logs, exploitation tests, or complete security audit.']
    (output / 'report.md').write_text('\n'.join(lines) + '\n')
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', required=True)
    parser.add_argument('--state')
    args = parser.parse_args()
    stop = os.environ.get('ATLAS_SECURITY_TRIAGE_STOP', 'false').lower()
    if stop not in ('true', 'false'):
        raise ValueError('Stop control must be true or false')
    result = run(args.output, args.state, stopped=stop == 'true')
    if os.environ.get('GITHUB_OUTPUT'):
        with open(os.environ['GITHUB_OUTPUT'], 'a') as stream:
            stream.write(f"changed={str(result['status'] == 'succeeded').lower()}\n")
    print(f"B4 triage: {result['status']} · {len(result['alerts'])} observed open alerts · 0 model calls")
    if result['status'] == 'incomplete':
        raise SystemExit(1)


if __name__ == '__main__':
    main()
