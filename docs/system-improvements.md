# Atlas System Improvement Analyst

This is a deterministic reports-only production automation, not an AI reasoning agent. It makes no model calls, installs no dependencies, runs no new builds or browser sessions, and never changes repository code. It complements GitHub Steward: Steward observes repository health in the desktop app; this workflow turns bounded source and CI evidence into a reviewable improvement report on GitHub, even when Atlas is closed.

## Run and review

After this change merges to main, each completed **CI** run from a main-branch push triggers **Atlas system improvements** once. PR CI and the agent's own runs do not trigger it. There is no polling or time-based schedule. A maintainer can also open **GitHub → ai-ops-atlas → Actions → Atlas system improvements → Run workflow**, selecting **main**.

Open the run's **Summary** for ranked candidates and coverage gaps. The **atlas-system-improvements** artifact contains `report.md` and `report.json` and expires after 14 days. Atlas registers the role as **System Improvement Analyst**, under ai-ops-atlas, and observes this workflow's actual runs. Before the workflow runs, no successful production execution is claimed.

The agent identifies recent sampled main-branch failures, unfinished or failed checks on the assessed commit, floor-dependent Canvas keys that could restart renderers, and source modules over 500 lines as low-priority refactoring candidates. File length alone is not a defect. It does not verify accessibility, screenshots, runtime behavior, security coverage, or the full workflow history. Review recommendations before implementing them.

## Usage limits

- Zero model/API spending for AI. No AI secrets or model subscriptions are required.
- One Ubuntu job with a three-minute timeout; Python standard library only.
- Two fixed GitHub GET endpoints, with ten-second timeouts, no redirects and no retries: ten recent main-branch push workflow runs and thirty checks for the exact assessed commit.
- At most 300 non-test TypeScript source files, 128 KiB per file, and 4 MiB in total. Symlinks are skipped. Credentials, logs, node_modules, and user folders are not read.
- At most eight findings. Reported omissions and missing evidence do not count as a clean result.
- Runner time and artifact storage still count against the GitHub account's plan. No claim of zero GitHub cost is made.

## Permissions and stop control

The workflow uses only its ephemeral `GITHUB_TOKEN` with contents/actions read permissions. Checkout credentials are not persisted. It accepts main-branch pushes from this repository only; there is no `pull_request_target`, external artifact download, issue creation, code change, CI retry, merge, or deployment path.

To stop it, open **Actions → Atlas system improvements → … → Disable workflow**. Re-enable there when ready. Findings require human review and a separately approved implementation; this agent cannot promote its own suggestions.

## Local validation

Run `python3 -m unittest discover -s ops/system-improvements -p 'test_*.py'`. For an offline report without GitHub requests, run:

```sh
python3 ops/system-improvements/report.py --sha <exact-40-character-commit> --output /tmp/atlas-improvements --offline
```

Offline reports explicitly state that GitHub evidence is unavailable. They are previews, not production executions.
