# Runbook: Service Desk in Atlas

Source: [Atlas Service Desk](https://github.com/khaneilcampbell/ai-ops-atlas/tree/main/apps/service-desk).
Run app commands from `apps/service-desk`. Installation, Docker and deployment documentation remain with the app. Real tickets must stay outside Git, mounted read-only behind authentication.

## CodeQL Scan

`.github/workflows/service-desk-codeql.yml` preserves the original Actions/Python security-extended scans and Monday 06:23 UTC schedule. Its registered agent remains `service-desk-codeql`. `.github/workflows/service-desk-ci.yml` preserves lint, tests, container smoke test, secret scan and dependency review. Nested `.github` files under the app are historical and do not run.

Inspect the relevant workflow run and security alerts; shared Atlas repository health alone does not verify this app. Stop controls remain workflow disable actions. No new business agents or external integrations are activated by migration.

Before deleting the old repository, verify the released Atlas selection/entry/floors and the external host's repository, app entry path, dependency discovery, secrets and private ticket mounts. See `docs/service-desk-migration.md` for backup and retirement gates.
