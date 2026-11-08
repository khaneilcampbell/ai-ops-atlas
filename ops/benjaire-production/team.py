"""Manual, local product handoff. No provider calls, publishing, feed writes or schedules."""
import argparse
import hashlib
import importlib.util
import json
import os
import re
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path

COMMERCE_SHA = '230605fdbde89585a96f35ded61cc17562f39135'  # Merged Commerce PR #26 dependency.
AGENTS = {'validate': 'atlas-production-coordinator', 'draft': 'canva-mockups', 'quality': 'commerce-tests', 'release': 'atlas-production-coordinator'}


def atomic(path, data):
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    temp = path.with_name(path.name + '.' + uuid.uuid4().hex + '.tmp')
    fd = os.open(temp, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'wb') as stream:
        stream.write(data)
    temp.replace(path)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def load_brief(path):
    if path.is_symlink() or not path.is_file() or path.stat().st_size > 65536:
        raise ValueError('Brief must be a regular local JSON file of at most 64 KiB')
    brief = json.loads(path.read_text())
    if not isinstance(brief, dict) or not isinstance(brief.get('product'), str) or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9 _-]{0,99}', brief['product']):
        raise ValueError('Invalid product identifier')
    if not isinstance(brief.get('id'), str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,80}', brief['id']):
        raise ValueError('Invalid brief identifier')
    if not isinstance(brief.get('fixture', False), bool):
        raise ValueError('Fixture must be an explicit boolean')
    for key, maximum in [('title', 255), ('description', 8000)]:
        if not isinstance(brief.get(key), str) or not 1 <= len(brief[key]) <= maximum:
            raise ValueError(f'Invalid {key}')
    brief['product'] = ' '.join(brief['product'].split())
    tags = brief.get('tags')
    if not isinstance(tags, list) or not 1 <= len(tags) <= 250 or any(not isinstance(t, str) or not 1 <= len(t) <= 255 for t in tags):
        raise ValueError('Invalid tags')
    price = brief.get('price')
    if isinstance(price, bool) or not isinstance(price, (int, float)) or not .01 <= price <= 99999:
        raise ValueError('Invalid price')
    return brief


def snapshots(path, brief):
    assets = brief.get('assets', [])
    if not isinstance(assets, list) or len(assets) > 6:
        raise ValueError('Provide at most six local JPEG handoff assets')
    result = []
    base = path.parent.resolve()
    for name in assets:
        if not isinstance(name, str) or Path(name).is_absolute() or '..' in Path(name).parts or Path(name).suffix.lower() != '.jpg':
            raise ValueError('Asset paths must be relative local JPEGs')
        file = base / name
        if any(p.is_symlink() for p in [file, *file.parents] if p != base.parent) or not file.resolve().is_relative_to(base) or not file.is_file() or file.stat().st_size > 5 * 1024 * 1024:
            raise ValueError('Unsafe, missing or oversized handoff asset')
        data = file.read_bytes()
        if len(data) > 5 * 1024 * 1024:
            raise ValueError('Asset changed beyond the size limit')
        result.append(data)
    return result


def quality_validator(commerce):
    # Load only the inspected pre-upload validator, never paid creation/publishing modules.
    import sys
    sys.path.insert(0, str(commerce / 'scripts'))
    spec = importlib.util.spec_from_file_location('commerce_pre_upload', commerce / 'scripts' / 'pre_upload_validator.py')
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module.validate


def run(brief_path, root, commerce, *, approve_hash=None, reviewer=None, stopped=False, validator=None, clock=time.monotonic, deadline=10):
    brief_path, root, commerce = Path(brief_path), Path(root), Path(commerce)
    brief = load_brief(brief_path)
    job_id = 'product-' + digest(brief['product'].strip().casefold().encode())[:24]
    job = root / job_id
    job.mkdir(parents=True, exist_ok=True, mode=0o700)
    lock = job / '.lock'
    fd = os.open(lock, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    os.write(fd, str(os.getpid()).encode())
    os.close(fd)
    started = clock()
    record = {'job_id': job_id, 'model_calls': 0, 'fixture': brief.get('fixture', False), 'stages': {}, 'history': []}
    revision = None

    def save(status, stage, reason=None):
        record.update(status=status, stage=stage, responsible_agent=AGENTS.get(stage, 'human-review-required'), observed_at=datetime.now(timezone.utc).isoformat(), reason=reason)
        event = {'stage': stage, 'status': status, 'at': record['observed_at']}
        history = record.setdefault('history', [])
        if not history or (history[-1]['stage'], history[-1]['status']) != (stage, status):
            history.append(event)
        record['history'] = history[-30:]
        data = (json.dumps(record, indent=2) + '\n').encode()
        atomic(job / 'job.json', data)
        if revision:
            atomic(revision / 'state.json', data)
        label = 'SYNTHETIC FIXTURE' if brief.get('fixture') else 'Supplied draft handoff'
        summary = f"# Benjaire production handoff\n\n{label}\n\nJob: {job_id}\nStage: {stage}\nState: {status}\nLast checked: {record['observed_at']}\nSource: local deterministic runner; creator generation not invoked\nModel calls: 0\n\n{reason or ''}\n\nReview hash: {record.get('review_hash', 'not ready')}\nNext action: {record.get('next_action', 'Review the local job report.')}\n\nPublication is never performed. Existing agents are stage owners; this report does not claim the external creator ran.\n"
        atomic(job / 'report.md', summary.encode())
        return record

    def check():
        if (root / 'STOP').exists():
            raise InterruptedError('Stop control is present')
        if clock() - started > deadline:
            raise TimeoutError('Stage deadline exceeded')

    try:
        if stopped or (root / 'STOP').exists():
            if (job / 'job.json').exists():
                record = json.loads((job / 'job.json').read_text())
            record.update(job_id=job_id, model_calls=0, next_action='Remove the stop control only after reviewing why the job was paused.')
            return save('blocked', 'control', 'Stopped before draft inspection.')
        assets = snapshots(brief_path, brief)
        rules = (commerce / 'scripts' / 'pre_upload_validator.py').read_bytes() + (commerce / 'scripts' / 'validation.py').read_bytes()
        version = digest(json.dumps(brief, sort_keys=True).encode() + b''.join(bytes.fromhex(digest(a)) for a in assets) + rules + Path(__file__).read_bytes())
        revision = job / 'revisions' / version
        record = json.loads((revision / 'state.json').read_text()) if (revision / 'state.json').exists() else {
            'job_id': job_id, 'input_hash': version, 'fixture': brief.get('fixture', False), 'model_calls': 0,
            'agents': AGENTS, 'creator_generation': 'not_invoked', 'execution_source': 'local deterministic handoff',
            'commerce_source_commit': COMMERCE_SHA, 'stages': {}, 'history': [],
        }
        save('queued', 'validate')
        check()
        record['stages']['validate'] = 'completed'
        if brief.get('creation_mode', 'supplied') != 'supplied' or not assets:
            record['next_action'] = 'Supply an approved draft and JPEG assets. Paid creator calls stay disabled until access and a hard budget ledger are implemented.'
            return save('blocked', 'draft', 'External generation requires paid AI/Canva; no creator call was made.')
        listing = json.dumps({k: brief[k] for k in ('title', 'description', 'tags', 'price')}, sort_keys=True).encode()
        expected = {'listing.json': digest(listing), **{f'mockup-{i}.jpg': digest(data) for i, data in enumerate(assets)}}
        draft = revision / 'draft' / brief['product']
        intact = all((draft / name).is_file() and not (draft / name).is_symlink() and digest((draft / name).read_bytes()) == sha for name, sha in expected.items())
        if not intact:
            record.pop('approval', None)
            record['stages'].pop('quality', None)
            save('running', 'draft')
            atomic(draft / 'listing.json', listing)
            for i, data in enumerate(assets):
                atomic(draft / f'mockup-{i}.jpg', data)
        record['stages']['draft'] = 'completed'
        record['review_hash'] = digest(json.dumps({'input': version, 'artifacts': expected}, sort_keys=True).encode())
        record['artifacts'] = {name: sha for name, sha in expected.items()}
        check()
        if record['stages'].get('quality') != 'completed':
            save('running', 'quality')
            result = (validator or quality_validator(commerce))(brief['product'], assets_dir=draft.parent, products_dir=revision / 'no-external-products')
            record['quality_checked_at'] = datetime.now(timezone.utc).isoformat()
            record['quality_failed_checks'] = len(result.errors)
            if not result.passed:
                record['next_action'] = 'Correct the supplied listing or mockup presence, then resume. No publishing is authorized.'
                return save('failed', 'quality', 'Existing Commerce validation found issues; draft artifacts are preserved.')
            record['stages']['quality'] = 'completed'
        check()
        if approve_hash:
            if approve_hash != record['review_hash'] or not reviewer or not re.fullmatch(r'[A-Za-z0-9 ._-]{1,80}', reviewer):
                record.pop('approval', None)
                record['next_action'] = 'Review this exact version and provide its review hash and reviewer identity.'
                return save('awaiting approval', 'approval', 'Approval does not match the reviewed version.')
            record['approval'] = {'hash': approve_hash, 'reviewer': reviewer, 'at': datetime.now(timezone.utc).isoformat()}
        if record.get('approval', {}).get('hash') != record['review_hash']:
            record['next_action'] = 'Review the local draft and quality result; approval must name the exact review hash. Do not publish.'
            return save('awaiting approval', 'approval', 'Quality passed; approval is still required.')
        check()
        if record['stages'].get('release') == 'completed' and not approve_hash:
            return save('completed', 'release', 'Unchanged approved release packet reused; nothing published.')
        save('running', 'release')
        atomic(revision / 'release-preparation.json', (json.dumps({'job_id': job_id, 'review_hash': record['review_hash'], 'fixture': record['fixture'], 'approval': record['approval'], 'artifacts': expected, 'publish_authorized': False}) + '\n').encode())
        record['stages']['release'] = 'completed'
        record['next_action'] = 'Release packet prepared locally. Publication needs a separate explicit decision and is not implemented here.'
        return save('completed', 'release', 'Release preparation only; nothing published.')
    except (TimeoutError, InterruptedError):
        record['next_action'] = 'Review stop/deadline conditions, then resume the same brief. Existing artifacts are retained.'
        return save('blocked', record.get('stage', 'control'), 'Stop control or stage deadline reached.')
    except (OSError, ValueError, TypeError, RuntimeError):
        record['next_action'] = 'Inspect local input availability and validation configuration; resume after repair.'
        return save('failed', record.get('stage', 'validate'), 'Local stage failed; sensitive error details were not exported.')
    finally:
        lock.unlink()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--brief', type=Path, required=True)
    parser.add_argument('--state-root', type=Path, required=True)
    parser.add_argument('--commerce-root', type=Path, required=True)
    parser.add_argument('--approve-hash')
    parser.add_argument('--reviewer')
    args = parser.parse_args()
    stop = os.environ.get('BENJAIRE_PRODUCTION_STOP', 'false').lower()
    if stop not in ('true', 'false'):
        parser.error('Stop control must be true or false')
    try:
        record = run(args.brief, args.state_root, args.commerce_root, approve_hash=args.approve_hash, reviewer=args.reviewer, stopped=stop == 'true')
        print(json.dumps({k: record.get(k) for k in ('job_id', 'status', 'stage', 'fixture', 'review_hash', 'reason')}, indent=2))
        if record['status'] in ('failed', 'blocked'):
            raise SystemExit(1)
    except (OSError, ValueError):
        parser.exit(1, 'Input invalid, unavailable, or job lock held. No external work started.\n')


if __name__ == '__main__':
    main()
