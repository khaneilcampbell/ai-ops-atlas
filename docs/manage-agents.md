# Manage agents

Agents → **Manage agents** lists the agents Atlas can manage: the ones that run on GitHub Actions in this repository. Each row shows status, schedule (in words, UTC, with the next run), the last run, the monthly cap and the building the agent works in. The building opens the map with that building selected. **Details** shows the last 10 runs on main.

## Controls (Mac app only)

In the Mac app, an agent's **Details** has **Enable/Disable** and **Run now**. The web app stays read-only.

Each press goes through `src-tauri/src/actions/agents.rs`:

1. The page sends only the agent id and the operation (`enable`, `disable`, `run_now`). The repository and workflow file come from the allow-list compiled into the app; an id that isn't on it is refused and logged as "(not on the allow-list)".
2. Refused without a Manage agents token, within 60 seconds of the last change to the same agent, or after 20 agent changes in an hour.
3. The workflow's state is read again from GitHub. If it no longer matches what the page showed, nothing is sent ("refresh and try again"). Enabling an enabled agent, disabling a disabled one, or running a disabled one is refused.
4. A macOS dialog shows **Before** and **After** (and, for Run now, that it uses default inputs and may spend within the agent's cap), then Touch ID.
5. An `attempted` line is written to the audit log (`audit.jsonl`) before the one request: `PUT …/actions/workflows/{file}/enable|disable` or `POST …/dispatches` with `ref: main` and no inputs. The outcome is a second line. Both show in Activity and in Settings → Actions.

### Schedule and cap changes (pull requests)

Under the buttons, **Schedule (cron, UTC)** and **Monthly cap (USD)** each have **Open pull request**. The page checks the value as it's typed; `src-tauri/src/actions/agent_config.rs` checks it again with the same rules (strict five-field numeric cron, runs at least 15 minutes apart or 4 hours for paid agents, caps in whole cents up to the entry's `maxUsd` and never above $5).

1. The page sends only the agent id, `schedule` or `cap`, and the new value. The files and the cap key come from the allow-list compiled into the app.
2. Same token, rate limits and lock as the controls above.
3. Atlas reads main's commit, then the workflow (or policy file) and `src/manage/agents.json` at that commit. It changes the one `- cron: "…"` line (or the one cap number), and the same agent's `schedule` (or `cap.usd`) in the allow-list. Each edit is re-parsed and refused if anything else would change.
4. A macOS dialog shows both before and after lines, then Touch ID, then an `attempted` audit line.
5. Writes: a branch `atlas/<agent>-<schedule|cap>-<UTC time>` from main, one commit per file on that branch, and a pull request into main whose body has the diff and a rollback note. The audit outcome is `opened` with the pull request number. **Nothing reaches main until you merge it**, and CI checks the allow-list against the changed file.

### Token

Settings → Actions → **Manage agents**: a separate fine-grained token, Only select repositories → `ai-ops-atlas`, Repository permissions → **Actions: Read and write** (Metadata read is added automatically). Schedule and cap pull requests also need **Contents**, **Pull requests** and **Workflows: Read and write**; you can add these to the same token later on its GitHub settings page. Create it at https://github.com/settings/personal-access-tokens/new. Atlas checks the account and that the token can see the repository, refuses a token already saved for something else, and keeps it in the Touch ID vault. It is read only by `actions/client.rs` at request time and never reaches the web view or the logs. Removing it turns the controls off.

GitHub can't limit a token to single workflows, so the allow-list does that. The token could also start Atlas's own CI or release workflows if it were used outside Atlas, which is why it is limited to one repository and kept only in the vault.

### Rollback

Remove the token in Settings (controls off at once), or revert the PR. A schedule or cap pull request is undone by closing it, or by reverting it after merging. Agents disabled from Atlas stay disabled until enabled again, from Atlas or on GitHub's workflow page (`…/actions/workflows/<file>` → Enable workflow).

## The allow-list: `src/manage/agents.json`

Only agents listed here appear, and later only these workflows and policy keys can be changed.

| Field | Meaning |
|---|---|
| `id` | Catalog agent id. Must exist in `catalog/` with `observe.github_workflow` set to `workflow`. |
| `workflow` | File under `.github/workflows/`. It must have exactly one `schedule` cron line and `workflow_dispatch`. |
| `schedule` | That cron line, exactly as on main. |
| `alsoRuns` | Other triggers in words. |
| `paid` | Calls a paid API. Paid agents run at most every 4 hours; others at most every 15 minutes. |
| `cap` | `file` (a JSON policy under `ops/`), `key` (dotted path to the monthly cap in dollars), `usd` (its value on main) and `maxUsd` (the most it can ever be set to, never above $5). |

`src/manage/manifest.test.ts` fails if an entry drifts from its workflow or policy file, breaks a limit, or names Atlas's own CI, release, CodeQL or visual workflows.

To add an agent (for example Spend Guard, Uptime Watch and Weekly Digest once PR #118 merges), add an entry and run `npm test`.

## Data use

The view reads GitHub only when it opens and when you press Refresh: one request for every workflow's state, plus one per agent for its runs on main. Requests send `If-None-Match`, so unchanged answers are 304s. Nothing polls. If GitHub can't be read or refuses the token, the view says so and still shows schedules and caps from Atlas itself, with unread fields marked Unknown.

The web build's GitHub proxy (`server/github.ts`) gained one read-only path, `/repos/{owner}/{repo}/actions/workflows`.
