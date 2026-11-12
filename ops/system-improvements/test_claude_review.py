import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from claude_review import command, main


class ClaudeReviewTests(unittest.TestCase):
    def test_explicit_model_read_only_no_tools_and_no_shell(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder) / 'repo'
            cmd = command(root, 'chosen-model', Path(folder) / 'report')
        self.assertEqual(cmd[:2], ['claude', '-p'])
        self.assertEqual(cmd[cmd.index('--tools') + 1], '')
        self.assertIn('--strict-mcp-config', cmd)
        self.assertIn('--no-session-persistence', cmd)
        self.assertEqual(cmd[cmd.index('--effort') + 1], 'low')
        self.assertNotIn('--dangerously-skip-permissions', cmd)

    def test_cannot_write_report_into_repository_or_accept_invalid_model(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            with self.assertRaises(ValueError):
                command(root, 'model', root / 'report')
            with self.assertRaises(ValueError):
                command(root, 'model; bad', root.parent / 'report')

    def test_dry_run_never_invokes_claude(self):
        with patch('sys.argv', ['claude_review.py']), patch('claude_review.subprocess.run') as run, patch('claude_review.subprocess.check_output', return_value='a'*40), patch('builtins.print'):
            main()
        run.assert_not_called()

    def test_run_requires_model_before_invoking_claude(self):
        with patch('sys.argv', ['claude_review.py', '--run']), patch('claude_review.subprocess.run') as run, patch('sys.stderr'):
            with self.assertRaises(SystemExit):
                main()
        run.assert_not_called()


if __name__ == '__main__':
    unittest.main()
