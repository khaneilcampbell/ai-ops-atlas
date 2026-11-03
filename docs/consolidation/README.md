# Repository consolidation and retirement

Prepared November 3, 2026. This migration adds source code to Atlas; it does not deploy the dashboard, move a database, activate n8n, or delete repositories.

## Current locations

| Project | Atlas location | Source repository | Retirement state |
| --- | --- | --- | --- |
| Skyline | `docs/skyline/`, `ops/skyline/`, existing city components | `khaneilcampbell/skyline` | Migration #207 merged; production and integration retirement gates still apply |
| Career Applications | `ops/career/` in PR #211 | `khaneilcampbell/career-application-system` | PR #211 open; do not delete |
| Benjaire Dashboard | `apps/benjaire-dashboard/` | `khaneilcampbell/benjaire-dashboard` | This migration is prepared; do not delete |
| Intelligence Hub | `docs/intelligence-hub/` | `khaneilcampbell/projects-intelligence-hub` | This migration is prepared; do not delete |

Service Desk is also consolidated in `apps/service-desk` via merged PR #213; its separate retirement gates are in `docs/service-desk-migration.md`.

This checklist covers these migrated source repositories only. **Keep `ai-ops-atlas` and all other business repositories.** Deleting every GitHub repository would destroy unrelated projects. Any broader retirement list needs a separate inventory and explicit approval.

Both newly imported repositories were public before migration. Their main trees were imported using unsquashed subtree merges, retaining original commits as Atlas ancestors. **Merge this PR with a merge commit, never squash or rebase.** Unmerged source branches remain in the full recovery backups rather than active Atlas code.

- Dashboard source main: `92f321745b37c2bdab2e730d5b2f84e97c854f3a`.
- Intelligence Hub source main: `ed1f4366c2b2f472534cc40240d492db83b1e305`.
- Existing project IDs, workers, buildings, interiors and floor assignments stay intact.
- Both project registrations link Atlas. CI agents observe the separate `dashboard-ci.yml` and `hub-ci.yml` workflows, not unrelated Atlas checks.
- Retired discovery aliases prevent cached source repositories from creating duplicate buildings or additional polling. Source entries were removed from merge-flow's allowlist.
- Nested source `.github` directories are retained history; only root workflows run in Atlas. Root dependency monitoring covers the dashboard's nested npm project.
- Shared Atlas repository health is not proof of dashboard uptime, database access, document freshness, or live agent execution.

## Run locally

Dashboard: run `npm ci` and `npm run ci` from `apps/benjaire-dashboard`. Its frontend, Worker and D1 migration files remain a separate application. Follow that app's `docs/SETUP.md`; do not run production migrations or deploy during consolidation. Finance records remain outside Git.

Hub: run the existing builder from `docs/intelligence-hub`, using a project folder containing `Source/project.json`. Its original hierarchy and committed DOCX files remain intact. Root Hub CI validates and renders sources in a disposable checkout, with optional seven-day DOCX downloads on manual dispatch. Rendering does not prove committed DOCX files are fresh.

## Recoverable backups

Local recovery folder:
`/Users/khaneil/.codex/visualizations/2026/10/29/01a18786-41e1-73c1-af9f-e409bb05bcb4`

For Dashboard and Hub, each has `<repository>-backup-2026-11-03.git`, `.bundle`, and `-metadata/`. Both bundles were restored into temporary mirrors and passed `git fsck --full`. Original Skyline and Career backup names start with `skyline-private-backup-2026-11-03` and `career-private-backup-2026-11-03`; those names describe initial visibility, not current visibility.

Metadata snapshots include accessible repository settings, branches, tags, issues, PRs, comments, release metadata, workflow listings, environments, rulesets, deployments, and secret names. Hook configuration values and secret values were not exported. API failures are recorded as unavailable; installed Apps and external integrations need owner review. These snapshots are not a complete GitHub-service backup: review threads, attachments, release binaries, Actions logs/artifacts, wikis, project boards, credentials, organization settings, and ignored local files require separate handling where applicable.

Common credential-pattern scans covered 138 Dashboard and 142 Hub history blobs with zero matches. This is a limited pattern check, not proof that all sensitive content is absent. Keep recovery copies outside the repository and make an additional offline copy before deletion.

## Delete only after every gate passes, per source repository

1. Merge the corresponding reviewed migration PR with passing required checks and a merge commit. Career #211 is separate from this PR; reconcile shared catalog, CI and retirement-list changes when merging both. Service Desk #213 has already been integrated here, preserving its retirement alias, tests and dependency monitoring.
2. Verify Atlas's deployed/released version: selection, linked Atlas repository, building entry, lobby, floor switching, all-floor view and exit. A local screenshot alone is insufficient.
3. For Dashboard, confirm Cloudflare Git integration now targets Atlas with build root `apps/benjaire-dashboard`; verify existing Worker name, D1 binding, Access policy, secrets and application health. Export/verify D1 data separately before any service changes. Keep source repo until this is completed with separate production authorization.
4. Review n8n workflow references, release/download URLs and external integrations. Preserve actual live n8n state and credentials in their existing secure storage. Imported JSON exports are not activated. For Career, preserve ignored personal workspaces separately and update any runner paths only after review. For Hub, redirect document links and optional artifact consumers.
5. Recheck source refs and metadata against the backup; capture and test any changes made since November 3. Copy any relevant release assets and discussions not covered by the backup. Check installed GitHub Apps where access is unavailable.
6. Get explicit owner approval naming the exact repository to delete. Archiving first is a reversible alternative after dependencies are removed.
7. Only then use that source repository's **Settings → General → Danger Zone → Delete this repository**, carefully confirming the full owner/name. Never delete Atlas. Recheck Atlas after each source retirement before proceeding to the next.

**No repository has been deleted by this migration. None of the four sources is declared safe to delete solely by this checklist.**

## Rollback

Before merge, close the PR: production is unchanged. After merge, prepare a reviewed revert restoring the catalog links, monitoring policy and migrated workflows together; do not remove data or reset Cloudflare services. Keep source repositories accessible until replacement verification completes.

Restore a source offline with `git clone --mirror /absolute/path/<repository>-backup-2026-11-03.bundle restored.git`, then `git --git-dir=restored.git fsck --full` and compare refs. Git bundles restore Git history, not GitHub settings, integrations, issues or live databases. Recreating or pushing a recovered GitHub repository requires separate authorization.

## Validation

- Atlas catalog/registry/security tests, type checks, lint and build passed; existing bundle-size warnings remain.
- Dashboard's existing `npm run ci` passed: Worker tests, types, build, secret scan and 11 Flow exports. Local D1 migrations and all 20 light/dark, desktop/phone accessibility/layout checks passed.
- Hub's six project metadata/source sets passed validation; 30 DOCX rendered successfully in temporary copies without rewriting committed documents.
- Both migrated building browser checks passed: Atlas repository panel, entry, Lobby, All floors, exit, and no page errors.
- Screenshots in `screenshots/` use synthetic GitHub fixtures; health badges are test data, not production verification. No visual baselines changed.
- Dashboard dependency installation reported one moderate advisory; no forced dependency upgrade was made as part of migration. Track it separately before changing its locked toolchain.
