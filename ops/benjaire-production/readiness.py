"""Manual campaign-readiness rehearsal; no network, model calls or external actions."""
import argparse
import json
import os
import re
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse

from team import atomic, digest

VERSION = 1
FIELDS = {'id', 'fixture', 'objective', 'research', 'campaign', 'product'}


def validate(value):
    if not isinstance(value, dict) or set(value) != FIELDS:
        raise ValueError('Expected only id, fixture, objective, research, campaign, product')
    if not isinstance(value['id'], str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,80}', value['id']):
        raise ValueError('Invalid objective ID')
    if not isinstance(value['fixture'], bool):
        raise ValueError('fixture must be an explicit boolean')
    for field in ('objective', 'campaign', 'product'):
        if not isinstance(value[field], str) or not 1 <= len(value[field]) <= 2000:
            raise ValueError(f'Invalid {field}')
    research = value['research']
    if not isinstance(research, list) or not 1 <= len(research) <= 10:
        raise ValueError('Supply 1–10 research claims with sources')
    for item in research:
        if not isinstance(item, dict) or set(item) != {'claim', 'source'}:
            raise ValueError('Research requires claim and source only')
        if not isinstance(item['claim'], str) or not 1 <= len(item['claim']) <= 2000:
            raise ValueError('Invalid research claim')
        source = item['source']
        if not isinstance(source, str) or len(source) > 2000:
            raise ValueError('Invalid source')
        url = urlparse(source)
        if url.scheme != 'https' or not url.hostname or url.username or url.password or url.query or url.fragment:
            raise ValueError('Use HTTPS evidence URLs without credentials, queries or fragments')
    return value


def packet(brief):
    """Supplied claims are references, never independently verified research or execution."""
    validate(brief)
    revision = digest(json.dumps({'contract': VERSION, 'brief': brief}, sort_keys=True).encode())
    stages = [
        ('benjaire_hq', 'objective.recorded', 'atlas-production-coordinator'),
        ('market_agency', 'campaign.supplied', 'benjaire-product-lab-research'),
        ('atlas_marketplace', 'readiness.blocked', 'commerce-tests'),
        ('benjaire_hq', 'summary.prepared', 'atlas-production-coordinator'),
    ]
    events = []
    for index, (domain, kind, agent) in enumerate(stages):
        events.append({'event_id': f'{revision}:{index}', 'event_type': kind, 'schema_version': VERSION,
                       'source_system': domain, 'destination_system': stages[index + 1][0] if index < 3 else 'atlas',
                       'correlation_id': brief['id'], 'causation_id': events[-1]['event_id'] if events else None,
                       'business_objective_id': brief['id'], 'entity_id': brief['id'], 'actor_type': 'local_runner',
                       'approval_status': 'pending', 'payload': {'stage_owner': agent, 'execution_source': 'supplied-input rehearsal'}})
    return {'revision': revision, 'fixture': brief['fixture'], 'state': 'awaiting approval',
            'workflow': 'manual campaign readiness', 'events': events,
            'readiness': 'blocked', 'blockers': ['Human review of exact supplied campaign required',
                'Research claims not independently verified', 'Checkout and fulfillment not verified'],
            'next_action': 'Review supplied evidence and verify product readiness through authorized test access',
            'model_calls': 0, 'publish_authorized': False, 'external_actions': False,
            'atlas_delivery': 'not connected; local report only'}


def run(path, root):
    path, root = Path(path), Path(root)
    if path.is_symlink() or not path.is_file() or path.stat().st_size > 32768:
        raise ValueError('Input must be a regular JSON file of at most 32 KiB')
    raw = path.read_bytes()
    if len(raw) > 32768:
        raise ValueError('Input exceeds 32 KiB')
    brief = validate(json.loads(raw))
    result = packet(brief)
    job = root / ('readiness-' + brief['id'])
    job.mkdir(parents=True, exist_ok=True, mode=0o700)
    lock = job / '.lock'
    fd = os.open(lock, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    os.close(fd)
    try:
        stop = os.getenv('BENJAIRE_PRODUCTION_STOP', 'false').lower()
        if stop not in ('true', 'false'):
            raise ValueError('Invalid stop control; refusing execution')
        if stop == 'true' or (root / 'STOP').exists():
            raise ValueError('Stopped: no readiness packet generated')
        target = job / result['revision']
        saved = target / 'packet.json'
        if saved.exists():
            prior = json.loads(saved.read_text())
            # Reuse only an intact deterministic packet, never approval flags from disk.
            expected = {k: v for k, v in prior.items() if k != 'observed_at'}
            for event in expected.get('events', []):
                if event.pop('timestamp', None) != prior.get('observed_at'):
                    raise ValueError('Saved event timestamp changed')
            if expected != result:
                raise ValueError('Saved packet changed; preserve it for investigation')
            return saved
        result['observed_at'] = datetime.now(timezone.utc).isoformat()
        for event in result['events']:
            event['timestamp'] = result['observed_at']
        atomic(target / 'supplied.json', (json.dumps(brief, indent=2) + '\n').encode())
        report = ['# Benjaire Flow readiness', '', 'SYNTHETIC FIXTURE' if brief['fixture'] else 'SUPPLIED INPUT — NOT VERIFIED',
                  '', f"Revision: {result['revision']}", 'State: awaiting approval · Marketplace readiness: blocked',
                  'No agents invoked; stage owners identify responsibility only.', '', *['- ' + b for b in result['blockers']],
                  '', 'Atlas: local report only; no telemetry delivered. No publishing, sending or paid calls.']
        atomic(target / 'report.md', ('\n'.join(report) + '\n').encode())
        atomic(saved, (json.dumps(result, indent=2) + '\n').encode())
        return saved
    finally:
        lock.unlink()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--brief', required=True)
    parser.add_argument('--state-root', required=True)
    args = parser.parse_args()
    try:
        print(run(args.brief, args.state_root))
    except (ValueError, OSError) as error:
        parser.exit(1, f'Readiness blocked: {error}\n')
