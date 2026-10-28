# Runbooks: khaneilcampbell.com

Repository: [khaneilcampbell/khaneilcampbell.com](https://github.com/khaneilcampbell/khaneilcampbell.com). Static pages served by GitHub Pages from `main`.

## Claude Site Assistant

Claude Code sessions that open pull requests; there is no code to run.

- **Run it:** ask for a change in a Claude Code session on this repository. It works on a branch and opens a pull request.
- **Check before merging:** Site CI and Security Check are green, and the change looks right on the pull request.
- **Undo it:** revert the merged pull request on GitHub.
- **Stop it:** don't start a session, or remove Claude's access to the repository at https://github.com/settings/installations.

## Site Audit

`scripts/site_audit.py`. Checks `_headers`, accessibility basics, internal links and credential-shaped strings.

- **Run it:** `python scripts/site_audit.py .` from the repository root (Python 3, no packages needed).
- **When it fails:** each finding names the file and the problem; a non-zero exit means at least one must be fixed. CI runs the same command.

## Security Check Workflow

`.github/workflows/security-check.yml`. Checks every root `*.html` page for a CSP meta tag, a referrer policy, `rel="noopener noreferrer"` on `target="_blank"` links and no `http://` resources, and that `_headers` lists the required headers. Inline event handlers only warn.

- **When it fails:** the failing step names the page. Run `bash scripts/security-check.sh` locally for the same checks.
- **Stop it:** disable the workflow in Actions.

## Site CI

`.github/workflows/site-ci.yml`.

- **When it fails:** reproduce with `pip install ruff && ruff check --select F scripts && python scripts/site_audit.py .`.
- **Site bundle:** run the workflow by hand with **bundle** ticked to download a zip of the site and `site-inventory.json`.
- **Stop it:** disable the workflow in Actions.
