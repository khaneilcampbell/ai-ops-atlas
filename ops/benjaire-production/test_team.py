import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from team import run, load_brief


class TeamTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.brief = self.root / 'brief.json'
        self.data = {'id': 'demo', 'product': 'Fixture Product', 'fixture': True, 'title': 'Fixture', 'description': 'Synthetic description', 'tags': ['fixture'], 'price': 10, 'assets': ['fixture.jpg']}
        self.write()
        (self.root / 'fixture.jpg').write_bytes(b'synthetic-presence-fixture')
        self.commerce = self.root / 'commerce'
        (self.commerce / 'scripts').mkdir(parents=True)
        for name in ('pre_upload_validator.py', 'validation.py'):
            (self.commerce / 'scripts' / name).write_text('# test adapter')
        self.output = self.root / 'jobs'
        self.calls = 0

    def write(self):
        self.brief.write_text(json.dumps(self.data))

    def validate(self, *_args, **_kwargs):
        self.calls += 1
        return SimpleNamespace(passed=True, errors=[])

    def execute(self, **kwargs):
        return run(self.brief, self.output, self.commerce, validator=kwargs.pop('validator', self.validate), **kwargs)

    def test_one_journey_stops_before_publication_and_reuses_quality(self):
        first = self.execute()
        self.assertEqual(first['status'], 'awaiting approval')
        second = self.execute()
        self.assertEqual(first['input_hash'], second['input_hash'])
        self.assertEqual(self.calls, 1)
        final = self.execute(approve_hash=first['review_hash'], reviewer='fixture-reviewer')
        self.assertEqual(final['status'], 'completed')
        packet = self.output / final['job_id'] / 'revisions' / final['input_hash'] / 'release-preparation.json'
        stamp = packet.stat().st_mtime_ns
        self.assertFalse(json.loads(packet.read_text())['publish_authorized'])
        self.assertEqual(self.execute()['status'], 'completed')
        self.assertEqual(stamp, packet.stat().st_mtime_ns)
        self.assertEqual(final['model_calls'], 0)
        self.assertEqual(final['creator_generation'], 'not_invoked')

    def test_changed_inputs_invalidate_approval_preserving_previous_packet(self):
        first = self.execute()
        approved = self.execute(approve_hash=first['review_hash'], reviewer='fixture-reviewer')
        self.data['description'] += ' Changed.'
        self.write()
        changed = self.execute(approve_hash=first['review_hash'], reviewer='fixture-reviewer')
        self.assertEqual(changed['status'], 'awaiting approval')
        self.assertNotEqual(changed['review_hash'], approved['review_hash'])
        self.assertNotIn('approval', changed)
        self.assertTrue((self.output / first['job_id'] / 'revisions' / first['input_hash'] / 'release-preparation.json').exists())

    def test_invalid_brief_and_asset_escape_rejected(self):
        self.data['price'] = True
        self.write()
        with self.assertRaises(ValueError):
            load_brief(self.brief)
        self.data['price'] = 10
        self.data['assets'] = ['../fixture.jpg']
        self.write()
        self.assertEqual(self.execute()['status'], 'failed')
        self.assertEqual(self.calls, 0)

    def test_stop_and_deadline_then_resume(self):
        self.assertEqual(self.execute(stopped=True)['status'], 'blocked')
        self.assertEqual(self.calls, 0)
        ticks = iter([0, 11])
        self.assertEqual(self.execute(clock=lambda: next(ticks))['status'], 'blocked')
        self.assertEqual(self.calls, 0)
        self.assertEqual(self.execute()['status'], 'awaiting approval')

    def test_failed_quality_keeps_draft_and_resumes(self):
        first = self.execute(validator=lambda *_a, **_k: SimpleNamespace(passed=False, errors=['private error text']))
        self.assertEqual(first['status'], 'failed')
        draft = self.output / first['job_id'] / 'revisions' / first['input_hash'] / 'draft' / self.data['product'] / 'listing.json'
        stamp = draft.stat().st_mtime_ns
        self.assertEqual(self.execute()['status'], 'awaiting approval')
        self.assertEqual(stamp, draft.stat().st_mtime_ns)
        self.assertNotIn('private error text', (self.output / first['job_id'] / 'job.json').read_text())

    def test_existing_lock_prevents_duplicate_concurrent_job(self):
        first = self.execute()
        lock = self.output / first['job_id'] / '.lock'
        lock.write_text('fixture owner')
        with self.assertRaises(FileExistsError):
            self.execute()
        self.assertEqual(lock.read_text(), 'fixture owner')

    def test_creator_without_supplied_assets_is_blocked_without_calls(self):
        self.data['assets'] = []
        self.write()
        result = self.execute()
        self.assertEqual(result['status'], 'blocked')
        self.assertEqual(result['stage'], 'draft')
        self.assertEqual(self.calls, 0)

    def test_exception_keeps_inputs_and_draft_for_recovery(self):
        def broken(*_a, **_k):
            raise RuntimeError('sensitive internal data')
        result = self.execute(validator=broken)
        self.assertEqual(result['status'], 'failed')
        self.assertNotIn('sensitive internal data', (self.output / result['job_id'] / 'job.json').read_text())
        self.assertEqual(self.execute()['status'], 'awaiting approval')

    def test_tampered_prepared_draft_revokes_cached_approval(self):
        first = self.execute()
        approved = self.execute(approve_hash=first['review_hash'], reviewer='fixture-reviewer')
        draft = self.output / approved['job_id'] / 'revisions' / approved['input_hash'] / 'draft' / self.data['product'] / 'listing.json'
        draft.write_text('{}')
        resumed = self.execute()
        self.assertEqual(resumed['status'], 'awaiting approval')
        self.assertNotIn('approval', resumed)
        self.assertEqual(self.calls, 2)
