import json
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from alert_triage import run, triage, collect, POLICY

REPOS = json.loads(POLICY.read_text())['repositories']


def evidence(alerts=None):
    return {'repositories': [{'repository': name, 'dependabot_alerts': {'status': 'observed', 'data': alerts or []}, 'code_scanning_alerts': {'status': 'observed', 'data': []}} for name in REPOS]}


class TriageTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.out = Path(self.temp.name) / 'report'
        self.state = Path(self.temp.name) / 'state.json'

    def test_priority_deduplication_and_no_sensitive_fields_exported(self):
        alerts = [{'number': 1, 'state': 'open', 'security_advisory': {'severity': 'low'}, 'body': 'private-marker'}, {'number': 2, 'state': 'open', 'security_advisory': {'severity': 'critical'}}]
        data = evidence(alerts + [alerts[1]])
        result = run(self.out, self.state, collector=lambda _: data)
        self.assertEqual(result['status'], 'succeeded')
        self.assertEqual(len(result['alerts']), 4)
        self.assertEqual(result['alerts'][0]['severity'], 'critical')
        self.assertNotIn('private-marker', (self.out / 'report.json').read_text())
        self.assertTrue(result['alerts'][0]['evidence'].startswith('https://github.com/khaneilcampbell/'))

    def test_unchanged_inputs_and_changes(self):
        run(self.out, self.state, collector=lambda _: evidence())
        stamp = self.state.stat().st_mtime_ns
        self.assertEqual(run(self.out, self.state, collector=lambda _: evidence())['status'], 'unchanged')
        self.assertEqual(stamp, self.state.stat().st_mtime_ns)
        self.assertEqual(run(self.out, self.state, collector=lambda _: evidence([{'number': 3, 'state': 'open'}]))['status'], 'succeeded')

    def test_unknown_access_missing_repositories_and_page_limits(self):
        self.assertTrue(triage({'repositories': []})[1])
        data = evidence()
        data['repositories'][0]['dependabot_alerts'] = {'status': 'unavailable'}
        self.assertEqual(run(self.out, self.state, collector=lambda _: data)['status'], 'incomplete')
        self.assertFalse(self.state.exists())
        self.assertTrue(triage(evidence([{'number': i+1, 'state': 'open'} for i in range(20)]))[1])

    def test_stop_reads_nothing(self):
        report = run(self.out, self.state, collector=lambda _: self.fail('Unexpected read'), stopped=True)
        self.assertEqual(report['status'], 'stopped')
        self.assertFalse(self.state.exists())

    def test_real_collector_timeout_produces_unknown_and_has_only_get_calls(self):
        with patch.dict(collect.__globals__, {'subprocess': subprocess}):
            with patch('subprocess.run', side_effect=subprocess.TimeoutExpired('gh', 8)) as api:
                report = run(self.out, self.state)
                self.assertEqual(report['status'], 'incomplete')
                self.assertEqual(api.call_count, 8)
                for call in api.call_args_list:
                    self.assertIn('GET', call.args[0])
                    self.assertLessEqual(call.kwargs['timeout'], 8)
        self.assertFalse(self.state.exists())

    def test_bad_records_and_untrusted_repositories(self):
        self.assertTrue(triage(evidence([{'number': True, 'state': 'open'}]))[1])
        with self.assertRaises(ValueError):
            triage({'repositories': [{'repository': 'other/repo'}]})

    def test_collector_failure_is_reported_without_error_body(self):
        def fail(_):
            raise OSError('private-error-body')
        self.assertEqual(run(self.out, self.state, collector=fail)['status'], 'incomplete')
        self.assertNotIn('private-error-body', (self.out / 'report.md').read_text())
