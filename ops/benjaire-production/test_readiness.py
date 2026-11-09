import copy
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from readiness import packet, run, validate

FIXTURE = Path(__file__).parent / 'fixtures/readiness.json'


class ReadinessTests(unittest.TestCase):
    def setUp(self):
        self.brief = json.loads(FIXTURE.read_text())

    def test_domain_chain_and_no_execution(self):
        result = packet(self.brief)
        self.assertEqual([e['source_system'] for e in result['events']],
                         ['benjaire_hq', 'market_agency', 'atlas_marketplace', 'benjaire_hq'])
        self.assertEqual(result['state'], 'awaiting approval')
        self.assertEqual(result['readiness'], 'blocked')
        self.assertFalse(result['publish_authorized'])
        self.assertFalse(result['external_actions'])
        self.assertEqual(result['model_calls'], 0)
        self.assertEqual(len({e['event_id'] for e in result['events']}), 4)

    def test_invalid_and_privileged_input(self):
        for key, value in [('fixture', 'false'), ('id', '../escape'), ('research', []), ('approval_status', 'approved')]:
            brief = copy.deepcopy(self.brief)
            brief[key] = value
            with self.subTest(key=key), self.assertRaises(ValueError):
                validate(brief)

    def test_source_rejects_credentials_and_query(self):
        for source in ['http://example.com', 'https://user:secret@example.com', 'https://example.com/?token=x']:
            self.brief['research'][0]['source'] = source
            with self.subTest(source=source), self.assertRaises(ValueError):
                validate(self.brief)

    def test_changed_draft_changes_revision(self):
        before = packet(self.brief)['revision']
        self.brief['campaign'] += ' Changed.'
        self.assertNotEqual(packet(self.brief)['revision'], before)

    def test_duplicate_resume_and_tamper(self):
        with tempfile.TemporaryDirectory() as root:
            path = run(FIXTURE, root)
            original = path.read_bytes()
            self.assertEqual(run(FIXTURE, root).read_bytes(), original)
            data = json.loads(original)
            data['publish_authorized'] = True
            path.write_text(json.dumps(data))
            with self.assertRaises(ValueError):
                run(FIXTURE, root)

    def test_stop_and_lock(self):
        with tempfile.TemporaryDirectory() as root:
            for stop in ['true', 'invalid']:
                with patch.dict(os.environ, {'BENJAIRE_PRODUCTION_STOP': stop}), self.assertRaises(ValueError):
                    run(FIXTURE, root)
            Path(root, 'STOP').touch()
            with self.assertRaises(ValueError):
                run(FIXTURE, root)
            Path(root, 'STOP').unlink()
            job = Path(root, 'readiness-' + self.brief['id'])
            (job / '.lock').touch()
            with self.assertRaises(FileExistsError):
                run(FIXTURE, root)

    def test_oversize_input(self):
        with tempfile.TemporaryDirectory() as root:
            path = Path(root, 'large.json')
            path.write_text(' ' * 32769)
            with self.assertRaises(ValueError):
                run(path, root)


if __name__ == '__main__':
    unittest.main()
