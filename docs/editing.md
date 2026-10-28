# Editing from Atlas

Atlas can make small changes for you without Claude or Codex: catalog details (names, purpose or summary, status, trigger, schedule, owner, links) and text files in a repository (README, docs, config). No AI is used for edits.

## How it works

1. Atlas opens read-only every time. Press **Edit** in the header (on a phone, **Turn on editing** in the inspector).
2. **Edit details** on an agent or project, or **Edit files** on a repository.
3. **Review changes** shows the exact diff. Nothing has been sent yet.
4. **Open pull request** creates a new `atlas-edit/<file>-<time>` branch from the default branch, commits that one file there and opens a pull request into the default branch. In the Mac app a macOS dialog asks once more first, and the attempt goes to the audit log.
5. Merge it from the repository's **PRs** tab (Merge from Atlas) or on GitHub.

Guardrails, the same in the Mac app (`src-tauri/src/actions/edit.rs`) and on the website (`server/edit.ts`):

- Never writes to the default branch: the write client only accepts `atlas-edit/` branches.
- The commit names the version of the file you edited; if it changed on GitHub meanwhile, GitHub refuses and Atlas asks you to reload.
- Workflow files (`.github/workflows/`) and anything in `.git` can't be edited. Text files only, up to 512 KB.
- Catalog edits change only the lines they touch, are checked by the catalog validator before review, and go to `khaneilcampbell/ai-ops-atlas`. The app shows them after the PR is merged and the app updates.
- At most 20 edit pull requests an hour from the Mac app.

## Turn it on in the Mac app

Edits reuse each repository's merge token (Contents and Pull requests: read and write, that repository only).

1. Settings → Actions → **Merge pull requests**: switch on and save a token for the repository, if you haven't already.
2. Settings → Actions → **Edit files**: switch on and tick the repository. Tick **ai-ops-atlas** to edit catalog details.

## Turn it on for the website (iPhone)

Off until both variables are set on the Cloudflare Pages project: https://dash.cloudflare.com/2ff911bc5c9acdcb7f6088b9a25f002f/pages/view/ai-ops-atlas/settings/production

- `GITHUB_EDIT_TOKEN` (encrypted): a fine-grained token from https://github.com/settings/personal-access-tokens/new with *Only select repositories* (the ones below) and **Contents** and **Pull requests**: Read and write.
- `EDIT_REPOS`: comma-separated, e.g. `khaneilcampbell/ai-ops-atlas,khaneilcampbell/benjaire.com`.

The site only reads file contents for repositories in `EDIT_REPOS`, and only accepts edits sent from its own page (same origin, JSON, `X-Atlas-Edit` header) behind the Cloudflare Access login. The website has no audit log or hourly cap of its own; GitHub's pull request history is the record.
