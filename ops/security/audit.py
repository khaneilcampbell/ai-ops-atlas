"""Read-only security evidence. Never emit alert bodies, secret values or API errors."""
import argparse
import json
import re
import subprocess
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def get(endpoint):
    try:
        result = subprocess.run(
            ['gh', 'api', '--hostname', 'github.com', '--method', 'GET', endpoint],
            capture_output=True, text=True, timeout=30, check=False,
        )
        if result.returncode:
            return None
        return json.loads(result.stdout)
    except (OSError, subprocess.TimeoutExpired, json.JSONDecodeError):
        return None


def environment_safe(environment, branches, signing_policy="team"):
    if not isinstance(environment, dict) or not isinstance(branches, dict):
        return False
    reviewers = [r for r in environment.get('protection_rules', []) if r.get('type') == 'required_reviewers']
    policy = environment.get('deployment_branch_policy') or {}
    rules = branches.get('branch_policies', [])
    review_safe = bool(reviewers and reviewers[0].get('prevent_self_review') is True
                       and reviewers[0].get('reviewers'))
    if signing_policy == 'solo':
        review_safe = not reviewers
    elif signing_policy != 'team':
        return False
    return bool(
        review_safe and environment.get('can_admins_bypass') is False
        and policy.get('custom_branch_policies') is True
        and len(rules) == 1 and rules[0].get('name') == 'main'
        and rules[0].get('type', 'branch') == 'branch'
    )


def alert_summary(data):
    # Only a bounded count, never vulnerability details or secret values.
    if not isinstance(data, list):
        return {'status': 'unavailable', 'open_count': None}
    return {'status': 'observed', 'open_count': len(data), 'possibly_truncated': len(data) == 100}


def audit(repo, signing_policy="team"):
    base = f'repos/{repo}'
    environment = get(base + '/environments/macos-signing')
    branches = get(base + '/environments/macos-signing/deployment-branch-policies')
    metadata = get(base)
    return {
        'repository': repo, 'observed_at': datetime.now(timezone.utc).isoformat(),
        'signing_policy': signing_policy,
        'signing_environment_verified': environment_safe(environment, branches, signing_policy),
        'security_features': metadata.get('security_and_analysis', 'unavailable') if isinstance(metadata, dict) else 'unavailable',
        'alerts': {name: alert_summary(get(base + '/' + path + '?state=open&per_page=100')) for name, path in (
            ('dependabot', 'dependabot/alerts'), ('code_scanning', 'code-scanning/alerts'),
            ('secret_scanning', 'secret-scanning/alerts'))},
        'limits': 'First 100 open alerts per category. Unavailable means unknown, never zero. No secret values or alert bodies are emitted.',
    }


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--repo', default='khaneilcampbell/ai-ops-atlas')
    parser.add_argument('--require-signing-environment', action='store_true')
    parser.add_argument('--local', action='store_true')
    parser.add_argument('--signing-policy', choices=['team', 'solo'], default='team')
    args = parser.parse_args()
    if args.local:
        raise SystemExit(subprocess.call(['node', 'ops/security/check-policy.mjs'], cwd=ROOT))
    if not re.fullmatch(r'[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+', args.repo):
        parser.error('Repository must be owner/name')
    report = audit(args.repo, args.signing_policy)
    print(json.dumps(report, indent=2))
    if args.require_signing_environment:
        raise SystemExit(0 if report['signing_environment_verified'] else 1)
