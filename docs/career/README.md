# Career Applications in Atlas

The Career Applications application lives under `ops/career/`, with project ID `career-optimizer` and all five existing agent IDs preserved. It links to `khaneilcampbell/ai-ops-atlas`. The source repository became public on November 3, 2026 before any publication of this migration. No personal workspace or API credentials were copied.

## Use locally

From the Atlas checkout, change to `ops/career/`, create a local virtual environment and install `requirements.txt`. Commands in the imported source guides run from that directory. `python -m jobflow --help` is an offline entry point. Analysis/tailoring commands still require a separately configured API key and can cost money; this migration does not execute or schedule them. No applications are submitted automatically.

Keep real data outside Git. Set `JOBFLOW_DATA` to your existing private workspace when using an existing database/tracker, or use the ignored `ops/career/private/` directory. Do not initialize over or replace an existing workspace. Preserve a separate backup of any ignored local records, resumes, tracker, outputs or environment configuration; none of these are included in a Git bundle.

The n8n workflow is an inactive source template. It is not imported, connected or activated by Atlas. Any existing n8n host's `JOBFLOW_HOME` still needs an explicit, controlled update to this checkout's `ops/career/` path after deployment verification. Credentials remain in the runtime secret store.

## Validation and CI

Atlas's existing root CI includes a Career Applications Python job: compile, lint, fake-model tests and a tracked-personal-files guard. No API key is supplied. The optional `career_tracker` manual input generates only a blank tracker artifact. Weekly dependency monitoring for `/ops/career` is preserved in the root Dependabot configuration. Nested `.github` files are retained as source history and are not active workflows/configuration.

The existing root CI result is the career validation agent's observed workflow; it covers the career job and the rest of Atlas. Before merge, old main workflow results do not prove the new career job has run. No production execution reporting has been added for local AI commands.

## History and backup

The source main commit `4dceac12569ffe4051ed48a5a89afdd3ef038a7c` is imported with an unsquashed subtree, preserving original ancestry. **Use a merge commit for this migration PR, never squash or rebase.** Other source branches remain in the local mirror and portable bundle. The bundle restored into a temporary mirror and passed `git fsck --full` (15 branches, all advertised PR refs).

Separate local API snapshots preserve accessible branch/tag, issue/PR, comment, release, workflow, ruleset, environment, deployment and hook inventory. Hook configuration and secret values are excluded. GitHub App installations, organization-level secrets, wiki content, project boards, Actions logs/artifacts, local ignored data and external runtime configuration are not fully backed up. Re-inventory before retirement; do not infer missing access means absent integrations.

## Retirement and rollback

1. Review and merge the migration with required checks passing, using a merge commit.
2. Verify the career job on Atlas main, and the updated production/desktop Career Applications panel, agent selection, building entry, floor navigation and exit.
3. Verify local commands using synthetic examples and the existing private workspace path. Do not run paid analysis just to test migration. If an n8n runtime is in use, verify and approve its path/configuration transition separately.
4. Review source branches/open PRs and external references. Refresh the backup for new changes and copy ignored personal data separately before removing any old local checkout.
5. Obtain explicit approval before archiving or deleting `career-application-system`. This migration does neither.

Before merge, close the migration PR to leave production unchanged. After merge, prepare a reviewed revert restoring catalog links, dependency monitoring and CI together. Keep the source repository available until verification is complete. Recover Git refs with `git clone --mirror /path/to/career-private-backup-2026-11-03.bundle career-restored.git`; metadata and runtime configuration require separate recovery. Recreating a remote repository or changing runtime settings requires separate approval.

## Local validation evidence

100 focused Atlas catalog, registry, map and office tests passed. The imported Python application passes all 27 fake-model tests, Ruff lint, compile checks and offline CLI help without an API key. Type checks, frontend lint/build, three security-audit unit tests and the local workflow-policy audit passed. Screenshots in `screenshots/` use synthetic GitHub fixtures and are not proof of production status. The source history scan checked 81 blobs for common private-key/GitHub-token/AWS-key patterns and found no matches; this does not establish that every possible sensitive value is absent.

Prepared and locally tested only. Not merged, deployed, activated, archived or deleted. GitHub checks on the migration PR and post-merge production/desktop validation remain separate gates.

The final browser check passed against a compiled production build: linked Atlas repository, office entry, Floor 2, Lobby, All floors and exit. An earlier development-preview recheck lost its office view while files were changing; the fixed-build run passed. No production or native desktop verification is implied.
