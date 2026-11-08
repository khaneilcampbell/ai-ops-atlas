# Skyline in Atlas

Skyline is a district and planned service within Atlas, maintained in `khaneilcampbell/ai-ops-atlas`. Its stable project ID remains `skyline`; the planned `skyline-inquiry-assistant` remains idle and unconnected. Shared Atlas repository health is not evidence that Skyline business operations run.

## Implementation

- Registration: `catalog/skyline.yaml`
- City models and routes: `src/views/map3d/`
- Interior and floor navigation: `src/views/office/SkylineInterior.tsx`
- Planned inquiry sandbox: `ops/skyline/`
- Service scope and acceptance checks: `docs/skyline-inquiry-assistant.md`

`source-history/` preserves the former repository's main tree and original Git ancestry through an unsquashed subtree import. **Merge this migration PR with a merge commit, never squash or rebase**, so original source commits remain ancestors of Atlas main. It is an archive, not the current implementation guide. Statements there about private visibility, separate ownership and worker registration are historical. Its nested `.github` files are inert documentation; Atlas's root workflows and security policy govern current development. Unmerged source branches remain in the separate recovery backup, not in active Atlas code.

## Migration and retirement gates

Prepared November 3, 2026, from the now-public Skyline repository. No unique application implementation was found in its main tree: it contains README, LICENSE, SECURITY and repository maintenance configuration. No private content was published before public visibility was verified.

The source inventory recorded three branches, no tags or releases, two pull requests (also returned by the issues API), zero repository hooks, environments, deployments, repository Actions secrets or repository Actions variables, and one ruleset. Installed GitHub Apps could not be enumerated with existing authentication; organization-level secrets, external services, wiki content, Actions artifacts/logs, and local clones are not established by those counts. Do not infer they are absent.

A local mirror and verified portable Git bundle preserve advertised branches, tags and pull-request refs. A temporary mirror restored from the bundle passed `git fsck --full`. Separate local metadata snapshots preserve accessible issue/PR records and comments, release metadata, workflow listings, rulesets and settings inventory. They are not a complete GitHub account backup. Secret values are never exported; hook configuration and variable values were deliberately excluded.

Before deletion:

- [ ] Merge the reviewed Atlas migration PR with passing required checks.
- [ ] Verify the deployed website and released desktop app: Skyline selection, Atlas repository inspection, building entry, all floors, lobby, floor switching and exit.
- [ ] Recheck Skyline for commits, branches, issues and integrations created after the backup; refresh and verify the backup if anything changed.
- [ ] Review both source pull requests and retain any relevant discussion/review evidence. Handle wiki, release assets, project boards, branch protection, security alerts and external links separately if applicable.
- [ ] Confirm GitHub App installation access and external service references manually where API access was unavailable.
- [ ] Obtain explicit owner approval to delete the source repository. This PR does not delete or archive it.

## Rollback and recovery

Before merge, close the migration PR to leave production unchanged. After merge, prepare a reviewed revert of the migration PR, restoring the former manifest link, monitoring policy and label source together. Keep the source repository available through production verification.

The original main commit `ab80b03964c90035e28f02237e439d80a439a25b` remains reachable through the subtree merge. The separate portable bundle can restore all backed-up refs with `git clone --mirror /path/to/skyline-private-backup-2026-11-03.bundle skyline-restored.git`; run `git fsck --full` and compare branch/tag refs before use. Recreating a GitHub repository and pushing recovered refs requires separate authorization. Git bundles cannot recreate GitHub issues, reviews, settings, secrets, installations or releases; recover those individually from the metadata snapshots where available.

## Validation evidence

- 91 focused catalog, registry, map-layout and office-model tests passed.
- Type checks, lint and production build passed. Existing bundle-size and Tauri dynamic-import warnings remain.
- Two browser checks passed: Skyline's project-first panel links Atlas before entry; its night interior retains all-floor view, lobby, Floor 2, apartment selection and exit.
- Reviewed `screenshots/repository-panel.png` and `screenshots/night-interior.png`. They use synthetic GitHub fixtures; green health indicators and the failing CI badge in these screenshots are fixture data, not a production health claim. No visual baselines were changed.
- A targeted scan of all six backed-up Git commits found no private-key, GitHub-token or AWS access-key patterns. This is not a guarantee that every possible secret format is absent.
- The old repository remains only as a retired discovery alias, so saved discovery data cannot recreate a duplicate building or cause another repository poll. The merge-flow monitoring allowlist no longer includes it.
- Prepared and locally tested only. Not merged, deployed, archived or deleted. Production replacement verification and explicit deletion approval remain required.
