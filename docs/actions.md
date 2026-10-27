# Approval-required actions

Atlas is read-only with one exception: **Re-run failed jobs** on a failed GitHub Actions run. It is autonomy level 2 (approval required): Atlas prepares the action and KC approves each run. It ships switched off.

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

## Where things live

| Path | Role |
|---|---|
| `src-tauri/src/actions/client.rs` | The only code that sends a GitHub write; builds the one URL itself |
| `src-tauri/src/actions/rerun.rs` | Checks, approval, audit and outcome mapping (with tests against fakes) |
| `src-tauri/src/actions/store.rs` | `actions.json` (switch and repositories) and `audit.jsonl`, in the app data folder under `actions/` |
| `src-tauri/src/actions/mod.rs` | Tauri commands, the native dialog, and a test that fails if a write request appears anywhere else |
| `src/actions/` | Web view API, state and button rules |
| `src/views/ActionsSettings.tsx` | Settings section |

## Turning it off

Any one of these stops it: untick the switch in Settings, remove the Actions token in Settings, or revoke the token on GitHub.
