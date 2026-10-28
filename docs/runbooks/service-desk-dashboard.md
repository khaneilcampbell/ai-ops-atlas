# Runbooks: Service Desk Intelligence Dashboard

Repository: [khaneilcampbell/service-desk-dashboard](https://github.com/khaneilcampbell/service-desk-dashboard) (public since 2026-10-28).

## CodeQL Scan

`.github/workflows/codeql.yml`. Scans the `actions` and `python` languages with the `security-extended` queries on pushes to `main`, pull requests and every Monday at 06:23 UTC.

- **Healthy:** latest run on `main` is green, and Security → Code scanning lists no open alerts you haven't triaged.
- **When it fails:** "Code scanning is not enabled" at upload means code scanning is off for the repository (it failed this way while the repository was private). Other failures are in the `Analyze` job log.
- **Triage an alert:** open it in Security → Code scanning, fix it in a pull request, or dismiss it with a reason.
- **Stop it:** disable the workflow in Actions.
