# Approval-required actions

Atlas is read-only with two exceptions: **Re-run failed jobs** on a failed GitHub Actions run, and **Merge pull request** on a pull request GitHub reports ready. Both are autonomy level 2 (approval required): Atlas prepares the action and KC approves each one. Both ship switched off, and both exist only in the Mac app; the website and iPhone build stay GET-only.

## How a re-run happens

1. The **Re-run failed jobs** button appears next to a failed run (repository inspector and Mission Control) only after the action is switched on in Settings. It is disabled, with the reason, when the repository isn't ticked, no Actions token is saved, or the run is older than 30 days.
2. The web view calls `action_rerun_failed(repo, run_id, seen_attempt)`. It cannot pass a URL, method or body.
3. The Rust side (`src-tauri/src/actions/rerun.rs`) checks, in order: valid repository, no other action in flight, switch on, repository ticked, Actions token saved. Then it re-reads the run with the **read-only** client and refuses unless the run belongs to that repository, is completed, failed or timed out, is still on the attempt the person saw, and is within 30 days. Atlas's own limits apply: one re-run per run every 10 minutes and 10 an hour.
4. A **native macOS dialog** names the workflow, repository, run, attempt, branch, commit and failed jobs. The web view can't answer it.
5. An `attempted` record is appended to the audit log. If that write fails, nothing is sent.
6. One `POST /repos/{owner}/{repo}/actions/runs/{run_id}/rerun-failed-jobs` is sent with the Actions token. It is never retried.
7. The result is appended to the audit log and shown under the button and in the Activity Center.

Every refusal and cancellation is logged too, so the log has one entry per press.

## Failures

| GitHub answer | Shown as |
|---|---|
| 201 | Started; Atlas refreshes so the new attempt appears |
| 401 | Token expired or revoked: replace it in Settings |
| 403 or 429 with rate-limit headers | Rate limited, with the time to try again |
| 403 otherwise | Refused; usually the token lacks Actions: write on that repository |
| 404 | The token can't see the repository or run |
| 409, 422 | GitHub can't re-run the run right now |
| Timeout after sending | Atlas re-reads the run. A higher attempt number means it started; otherwise the outcome is recorded as unknown |

## The Actions token

A separate fine-grained personal access token, stored in the Keychain under `github-actions-write-token`:

- Resource owner: the account that owns the repositories
- Repository access: **Only select repositories**
- Repository permissions: **Actions: Read and write** (GitHub adds Metadata: Read). Nothing else.
- An expiry of 90 days or less

Atlas rejects classic `ghp_` tokens and the read-only token in this slot, and checks the token with `GET /user` before saving it. The read-only client in `github.rs` never reads it. Removing the token in Settings also switches the action off.

## Merging a pull request

Merging is the riskier action (it can't be undone), so it has stricter rules than re-runs and no override of any kind.

1. Settings → Actions → **Merge pull requests** switches it on. Each repository needs **its own** fine-grained token (below) before it can be ticked.
2. A repository's inspector has a **PRs** tab listing its open pull requests (read-only; this list also works on the website). In the Mac app, with merging on for that repository, Atlas checks each non-draft pull request (up to 10) with `action_merge_check`, which is read-only and not logged. The **Merge** button appears only on pull requests that pass every check below; the others show why.
3. Pressing Merge calls `action_merge_pr(repo, number, seen_sha)`. The Rust side (`src-tauri/src/actions/merge.rs`) checks, in order: no other merge in flight, valid repository, switch on, repository ticked, merge token saved for it. Then it reads with the **read-only** client and refuses unless:
   - the pull request belongs to that repository, is open, not merged, **not a draft**, and its head is still the commit the button was shown for;
   - GitHub reports `mergeable: true` and `mergeable_state: "clean"` (so `blocked`, `behind`, `dirty`, `unstable` and `unknown` all refuse);
   - no reviewer's latest review is **changes requested**;
   - every check run on the head commit is completed and `success`, `neutral` or `skipped`, every commit status is `success`, and there is at least one;
   - the base branch **requires** status checks (classic branch protection or a ruleset), and every required check is among those that passed. A base branch with no required checks is refused, so GitHub's own protection always backs the merge.
   Atlas's own limits apply: one merge per pull request every 10 minutes and 5 an hour.
4. A **native macOS dialog** names the pull request, branches, author, size, head commit, required checks and approvals.
5. **Touch ID** (or the Mac's password) is asked for again, for this one merge. This is on top of the vault unlock at launch.
6. An `attempted` record is appended to the audit log. If that write fails, nothing is sent.
7. One `PUT /repos/{owner}/{repo}/pulls/{number}/merge` is sent with that repository's merge token, `merge_method: "squash"` and `sha` set to the approved head commit, so GitHub refuses (409) if anything was pushed after the dialog. It is never retried.
8. The result is appended to the audit log and shown under the pull request and in the Activity Center.

Nothing proposes merges: the approval queue only ever holds re-runs, and the Merge Pull Request agent stays at level 2 permanently.

| GitHub answer | Shown as |
|---|---|
| 200 | Merged; Atlas refreshes the repository |
| 401 | Token expired or revoked: replace it in Settings |
| 403 | Refused; usually the token lacks Pull requests or Contents: write |
| 404 | The token can't see the repository or pull request |
| 405 | GitHub won't merge it (for example a rule Atlas couldn't see, or squash merges are off) |
| 409 | The branch changed after approval; nothing merged |
| Timeout after sending | Atlas re-reads the pull request. `merged: true` means it landed; otherwise the outcome is recorded as unknown |

### Merge tokens

One fine-grained personal access token **per repository**, stored in the Keychain vault under `github-merge-token:owner/name`:

- Repository access: **Only select repositories**, just that one
- Repository permissions: **Pull requests: Read and write** and **Contents: Read and write** (GitHub adds Metadata: Read). Nothing else.
- An expiry of 90 days or less

Atlas rejects classic `ghp_` tokens and any token already saved for something else (the read-only token, the Actions token, another repository's merge token), checks the token with `GET /user` and `GET /repos/{owner}/{repo}` before saving it, and never returns it to the web view. Removing a repository's token also unticks it.

## Where things live

| Path | Role |
|---|---|
| `src-tauri/src/actions/client.rs` | The only code that sends a GitHub write; builds both URLs itself |
| `src-tauri/src/actions/rerun.rs` | Re-run checks, approval, audit and outcome mapping (with tests against fakes) |
| `src-tauri/src/actions/merge.rs` | Merge readiness checks, approval, Touch ID, audit and outcome mapping (with tests against fakes) |
| `src-tauri/src/actions/store.rs` | `actions.json` (switch and repositories) and `audit.jsonl`, in the app data folder under `actions/` |
| `src-tauri/src/actions/mod.rs` | Tauri commands, the native dialog, and a test that fails if a write request appears anywhere else |
| `src/actions/` | Web view API, state and button rules |
| `src/components/PullRequests.tsx` | The inspector's PRs tab and Merge button |
| `src/views/ActionsSettings.tsx` | Settings section |

## Turning it off

Any one of these stops a re-run: untick the switch in Settings, remove the Actions token in Settings, or revoke the token on GitHub.

Any one of these stops merging: untick **Merge pull requests**, untick the repository, remove its merge token in Settings, or revoke the token on GitHub.

## Fix with Claude (not a write action)

Mission Control's **Fix with Claude** button is a link, not an action: it opens a pre-filled issue in
`khaneilcampbell/ai-ops-atlas` labeled `claude-fix`, in the browser. Atlas holds no token for it and
sends nothing. Pressing **Create** on GitHub is the approval; a Claude Code scheduled task on KC's
account then follows `ops/fix-with-claude/prompt.md` and opens one pull request for KC to merge. See
[ops/fix-with-claude/README.md](../ops/fix-with-claude/README.md).
