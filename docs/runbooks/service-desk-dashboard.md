# Runbooks: Service Desk Intelligence Dashboard

Repository: [khaneilcampbell/service-desk-dashboard](https://github.com/khaneilcampbell/service-desk-dashboard) (public since 2026-10-28).

## CodeQL Scan

`.github/workflows/codeql.yml`. Scans the `actions` and `python` languages with the `security-extended` queries on pushes to `main`, pull requests and every Monday at 06:23 UTC.

- **Healthy:** latest run on `main` is green, and Security → Code scanning lists no open alerts you haven't triaged.
- **When it fails:** "Code scanning is not enabled" at upload means code scanning is off for the repository (it failed this way while the repository was private). Other failures are in the `Analyze` job log.
- **Triage an alert:** open it in Security → Code scanning, fix it in a pull request, or dismiss it with a reason.
- **Stop it:** disable the workflow in Actions.

## Insights Analyst

`.github/workflows/insights.yml` runs `sdd-insights` (`src/service_desk_dashboard/insights.py`) every Monday at 13:00 UTC and on demand. It computes the dashboard's figures, sends only those aggregates to Claude and publishes the brief to the run summary and the `insights-brief` artifact. Details in the repository's `docs/insights.md`.

- **Healthy:** latest run on `main` is green and its summary shows a brief with no "Check these figures" note.
- **When it fails:** "Missing secret" means `ANTHROPIC_API_KEY` is not set under Settings → Secrets and variables → Actions. "Anthropic API returned HTTP …" carries the API's own error (bad key, model name, rate limit). "No JSON brief" means the model's reply could not be parsed; re-run once.
- **"Check these figures" note:** the brief quoted a number that is not in the computed figures. Trust the figures table, not the sentence.
- **Without Claude:** start the workflow with `dry_run` to get the figures alone.
- **Stop it:** disable the workflow in Actions, or delete the secret.
