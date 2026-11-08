import tempfile
import unittest
from pathlib import Path

from report import collect, ci_findings, source_findings, markdown, get_json

SHA = 'a' * 40


class ReportTests(unittest.TestCase):
    def test_offline_never_requests_github_and_marks_missing_evidence(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            (root / 'src').mkdir()
            report = collect(root, SHA, fetch=lambda _: self.fail('Unexpected request'), offline=True)
        self.assertEqual(report['github_requests'], 0)
        self.assertEqual(report['model_calls'], 0)
        self.assertTrue(report['unavailable'])
        self.assertIn('not establish', markdown(report))

    def test_new_success_supersedes_old_failure_for_same_workflow(self):
        runs = {'workflow_runs': [
            {'id': 2, 'created_at': '2026-10-30', 'path': 'ci.yml', 'head_branch': 'main', 'event': 'push', 'status': 'completed', 'conclusion': 'success'},
            {'id': 1, 'created_at': '2026-10-29', 'path': 'ci.yml', 'head_branch': 'main', 'event': 'push', 'status': 'completed', 'conclusion': 'failure'},
        ]}
        findings, _ = ci_findings(runs, {'check_runs': []}, SHA)
        self.assertEqual(findings, [])

    def test_latest_failure_is_linked_and_pending_evidence_is_not_a_pass(self):
        runs = {'workflow_runs': [{'id': 12, 'path': 'ci.yml', 'head_branch': 'main', 'event': 'push', 'status': 'completed', 'conclusion': 'failure'}]}
        findings, unavailable = ci_findings(runs, {'check_runs': [{'status': 'in_progress'}]}, SHA)
        self.assertEqual(findings[0]['priority'], 'high')
        self.assertTrue(findings[0]['evidence'].endswith('/12'))
        self.assertIn('unfinished', ' '.join(unavailable))
        findings, unavailable = ci_findings(None, None, SHA)
        self.assertEqual(findings, [])
        self.assertEqual(len(unavailable), 2)

    def test_exactly_two_bounded_evidence_reads(self):
        calls = []
        def fetch(endpoint):
            calls.append(endpoint)
            return {'workflow_runs': [], 'check_runs': []}
        with tempfile.TemporaryDirectory() as folder:
            collect(Path(folder), SHA, fetch=fetch)
        self.assertEqual(len(calls), 2)
        self.assertIn('per_page=10', calls[0])
        self.assertIn('per_page=30', calls[1])

    def test_source_scan_flags_floor_canvas_remounts_without_reading_external_symlinks(self):
        with tempfile.TemporaryDirectory() as folder, tempfile.TemporaryDirectory() as external:
            root = Path(folder)
            (root / 'src').mkdir()
            (root / 'src' / 'Office.tsx').write_text('<Canvas key={floor === -1 ? "all" : "single"}>')
            outside = Path(external) / 'Secret.tsx'
            outside.write_text('secret')
            (root / 'src' / 'link.tsx').symlink_to(outside)
            findings, _, coverage = source_findings(root)
        self.assertEqual(len(findings), 1)
        self.assertEqual(findings[0]['key'], 'canvas:src/Office.tsx')
        self.assertEqual(coverage['files'], 1)

    def test_large_source_is_unavailable_not_a_silent_clean_result(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            (root / 'src').mkdir()
            (root / 'src' / 'Big.tsx').write_text('x' * (128 * 1024 + 1))
            findings, unavailable, _ = source_findings(root)
        self.assertFalse(findings)
        self.assertIn('per-file', unavailable[0])

    def test_rejects_unapproved_endpoints_and_invalid_commit(self):
        with self.assertRaises(ValueError):
            get_json('/issues')
        with self.assertRaises(ValueError):
            collect(Path('.'), 'main', offline=True)


if __name__ == '__main__':
    unittest.main()
