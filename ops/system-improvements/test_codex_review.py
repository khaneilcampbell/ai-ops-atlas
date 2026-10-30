import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from codex_review import command, main


class CodexReviewTests(unittest.TestCase):
    def test_explicit_model_read_only_no_user_config_and_no_shell(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder) / 'repo'
            cmd = command(root, 'chosen-model', Path(folder) / 'report')
        self.assertEqual(cmd[:2], ['codex', 'exec'])
        self.assertIn('read-only', cmd)
        self.assertIn('--ignore-user-config', cmd)
        self.assertIn('--ephemeral', cmd)
        self.assertIn('model_reasoning_effort="low"', cmd)
        self.assertNotIn('--full-auto', cmd)

    def test_cannot_write_report_into_repository_or_accept_invalid_model(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            with self.assertRaises(ValueError):
                command(root, 'model', root / 'report')
            with self.assertRaises(ValueError):
                command(root, 'model; bad', root.parent / 'report')

    def test_dry_run_never_invokes_codex(self):
        with patch('sys.argv', ['codex_review.py']), patch('codex_review.subprocess.run') as run, patch('codex_review.subprocess.check_output', return_value='a'*40), patch('builtins.print'):
            main()
        run.assert_not_called()

    def test_run_requires_model_before_invoking_codex(self):
        with patch('sys.argv', ['codex_review.py', '--run']), patch('codex_review.subprocess.run') as run, patch('sys.stderr'):
            with self.assertRaises(SystemExit):
                main()
        run.assert_not_called()


if __name__ == '__main__':
    unittest.main()
