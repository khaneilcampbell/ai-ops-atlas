# Service Desk consolidation into Atlas

Prepared November 3, 2026. Source repository `khaneilcampbell/service-desk-intelligence` was verified **public** before import or publication. It was previously private; the recovery files retain their original private-backup names.

## Preserved implementation

- App, tests, dependency pins, Dockerfile, Streamlit configuration, documentation and license now live under `apps/service-desk/`.
- An unsquashed subtree import preserves original main commit `6d1866b6e4b1b0204d05f3710e0ad54a103ead44` as an Atlas ancestor. **Use a merge commit; do not squash or rebase this migration PR.** Unmerged source branches stay in the full backup rather than active Atlas code.
- Project `service-desk` and worker `service-desk-codeql` keep their stable IDs. The building, selection panel, interior and floor navigation remain unchanged. The linked repository is Atlas.
- Registered security activity observes `service-desk-codeql.yml`, preserving Python/Actions security-extended scanning and the existing weekly schedule. Root `service-desk-ci.yml` preserves app lint/tests, container smoke checks, secret scan and dependency review. Nested source workflows are retained history and do not run in Atlas.
- Root Dependabot monitors the nested Python and Docker manifests. The old repository is removed from merge-flow monitoring and suppressed in saved discovery results, avoiding duplicate buildings/polling.
- Shared Atlas repository health is not evidence of Streamlit uptime or live Service Desk operations. No real ticket data, credentials, hosted service settings or external integrations were imported or activated.

## Run and host

Run installation/test/Docker commands from `apps/service-desk`. Local entry: `streamlit run streamlit_app.py`. App tests use synthetic tickets or disposable test CSVs.

For existing Streamlit hosting, the new repository is Atlas and entry is `apps/service-desk/streamlit_app.py`. Verify nested dependency and configuration discovery before switching. Alternatively build the existing Dockerfile with `apps/service-desk` as its build context. Existing hosting remains unchanged; deployment requires separate authorization. Real ticket exports must remain outside Git and the image, read-only and behind authentication. The app has no built-in login.

## Verified local backup

Recovery folder:
`/Users/khaneil/.codex/visualizations/2026/10/29/01a18786-41e1-73c1-af9f-e409bb05bcb4`

Files: `service-desk-private-backup-2026-11-03.git`, `.bundle`, and `-metadata/`. The bundle was restored to a separate mirror and passed `git fsck --full`. Eleven branches and all advertised refs are retained. A limited common-credential-pattern check scanned 69 history blobs with zero matches; this is not a guarantee of absence of every sensitive format.

Metadata snapshots preserve accessible repository details, branches, tags, issue/PR records and comments, releases metadata, workflow listings, environments, deployments, rulesets and secret names. Unavailable API results are recorded. GitHub Apps, organization settings, wiki/project boards, attachments, release assets, Actions artifacts/logs, external hosting, real ticket exports and ignored local files need separate review. Secret values are not exported. Copy the backup to another secure location before deleting the source.

## Retirement checklist

This adds Service Desk to the previously prepared Skyline, Career Applications, Dashboard and Hub retirement scope. **Keep Atlas and unrelated business repositories.** Career #211 and Dashboard/Hub #212 are separate open migrations; this branch does not merge them. Reconcile overlapping catalog tests, retired aliases and dependency configuration when integrating the PRs.

- [ ] Merge this reviewed migration with required checks passing, using a merge commit.
- [ ] Verify the released Atlas app: Service Desk panel, Atlas repository link, entry, lobby, floor switching, All floors and exit.
- [ ] Verify the hosted Streamlit/container replacement from Atlas, including app entry, dependencies, configuration, health and any authentication/data mount. Update source repository deployment links only with separate production authorization.
- [ ] Review open branches/PRs, installed Apps, external hooks and source download/document links. Refresh and restore-check backups for changes since this inventory.
- [ ] Preserve any private ticket exports and operational configuration outside Git. Git history cannot recover these.
- [ ] Obtain explicit owner approval naming `khaneilcampbell/service-desk-intelligence` before deletion. Archiving is a reversible alternative once dependencies are removed.
- [ ] Only then delete that source through its GitHub Settings → General → Danger Zone. Never delete Atlas. Verify Atlas and the hosted app afterward.

No merge, deployment, source archival or deletion was performed by preparation of this PR. Do not delete the source based only on successful local tests.

## Rollback

Before merge, close the PR to leave production unchanged. After merge, prepare a reviewed revert restoring catalog, discovery/monitoring and root CI files together; do not reset hosted data or services. Restore Git offline with `git clone --mirror /absolute/path/service-desk-private-backup-2026-11-03.bundle restored.git`, then run `git --git-dir=restored.git fsck --full` and compare refs. GitHub settings, issues, releases, integrations and runtime data need separate recovery. Recreating/pushing a repository requires separate authorization.

## Validation

- 26 Service Desk Python tests passed, including synthetic-data rendering, CSV input/errors and root-entry rerun; Ruff lint and format passed.
- Focused Atlas catalog/registry/workflow-security tests, type checks, lint, build and security workflow policy passed.
- Local Streamlit root-entry health returned `ok`. The compiled Atlas browser test passed repository selection, building entry, Lobby, All floors, exit and no page errors.
- Docker is unavailable locally; the preserved container build and health check run in GitHub CI. External host settings and production are not verified.
- Screenshots use synthetic GitHub fixtures; green badges are not production verification. No visual baselines changed. Existing Atlas build warnings remain.

### Merge validation scanner repair

The imported root commit has no parent, so the scanner action's inferred PR range failed. Its PR base now uses GitHub's actual Atlas base SHA, followed by a full-history `--all` scan including subtree ancestry. One existing historical test fixture (the sample idempotency ID in `server/inquiryReply.test.ts`, fakeD1/mocked fetch) triggered generic-api-key. `.gitleaksignore` documents only that exact commit/file/rule/line fingerprint; no rule or directory is excluded. Full local history scan and inquiry-reply tests passed with that narrow fixture exception.
