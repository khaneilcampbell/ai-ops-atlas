import json
import tempfile
import unittest
from pathlib import Path
from reliability import run

SHA = 'a' * 40


def evidence(endpoint):
    return {'workflow_runs': [{'id': 12, 'path': 'ci.yml', 'head_branch': 'main', 'event': 'push', 'status': 'completed', 'conclusion': 'failure'}]} if endpoint.startswith('/actions') else {'check_runs': [{'status': 'completed', 'conclusion': 'success'}]}


class ReliabilityTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.out = Path(self.tmp.name) / 'output'
        self.state = Path(self.tmp.name) / 'state.json'

    def test_live_evidence_is_linked_and_duplicate_does_not_rewrite_state(self):
        first = run(SHA, self.out, self.state, fetch=evidence)
        stamp = self.state.stat().st_mtime_ns
        second = run(SHA, self.out, self.state, fetch=evidence)
        self.assertEqual(first['status'], 'succeeded')
        self.assertTrue(first['findings'][0]['evidence'].endswith('/12'))
        self.assertEqual(second['status'], 'unchanged')
        self.assertEqual(stamp, self.state.stat().st_mtime_ns)
        self.assertEqual(json.loads((self.out / 'report.json').read_text())['model_calls'], 0)

    def test_stop_never_reads_or_advances_state(self):
        report = run(SHA, self.out, self.state, fetch=lambda _: self.fail('Unexpected request'), stopped=True)
        self.assertEqual(report['status'], 'stopped')
        self.assertFalse(self.state.exists())

    def test_timeout_is_incomplete_and_retry_can_recover(self):
        def timeout(_):
            raise TimeoutError('Do not include response or token in output')
        self.assertEqual(run(SHA, self.out, self.state, fetch=timeout)['status'], 'incomplete')
        self.assertFalse(self.state.exists())
        self.assertNotIn('token', (self.out / 'report.md').read_text())
        self.assertEqual(run(SHA, self.out, self.state, fetch=evidence)['status'], 'succeeded')

    def test_unavailable_or_pending_evidence_never_marks_success(self):
        for fetch in (lambda _: None, lambda _: {'workflow_runs': [], 'check_runs': [{'status': 'in_progress'}]}):
            self.assertEqual(run(SHA, self.out, self.state, fetch=fetch)['status'], 'incomplete')
            self.assertFalse(self.state.exists())

    def test_invalid_input_is_rejected_before_reads(self):
        with self.assertRaises(ValueError):
            run('main', self.out, fetch=lambda _: self.fail('Unexpected request'))

    def test_changed_evidence_is_not_suppressed(self):
        run(SHA, self.out, self.state, fetch=evidence)
        self.assertEqual(run('b' * 40, self.out, self.state, fetch=evidence)['status'], 'succeeded')

    def test_corrupt_state_is_a_cache_miss(self):
        self.state.write_text('not json')
        self.assertEqual(run(SHA, self.out, self.state, fetch=evidence)['status'], 'succeeded')

    def test_cli_transport_has_fixed_read_endpoints_and_timeout(self):
        import subprocess
        from unittest.mock import patch
        from reliability import gh_json
        with patch('reliability.subprocess.run', return_value=subprocess.CompletedProcess([], 0, b'{"check_runs": []}', b'')) as call:
            self.assertEqual(gh_json(f'/commits/{SHA}/check-runs?per_page=30'), {'check_runs': []})
            self.assertEqual(call.call_args.kwargs['timeout'], 10)
            self.assertNotIn('shell', call.call_args.kwargs)
        with self.assertRaises(ValueError):
            gh_json('/issues')
        with patch('reliability.subprocess.run', side_effect=subprocess.TimeoutExpired('gh', 10)):
            self.assertIsNone(gh_json('/actions/runs?branch=main&event=push&per_page=10'))
