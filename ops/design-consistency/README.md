# Design Consistency

Design Consistency is the third agent in the GitHub building (project `github-profile`, agent `github-design-consistency`), next to Merge Flow and Opportunity Scout. It keeps Atlas on one design system: every color, type size, spacing step, font and radius comes from `src/styles/tokens.css`, and building and agent names follow the scheme from the label cleanup (short Title Case, brand first, no domains or dashes). When something drifts it opens one pull request that brings it back, with before and after screenshots. It never merges; KC says "merge".

## The tokens file

`src/styles/tokens.css` is the single source. It holds the current Atlas look (the polished green-and-gold theme that used to be split between `app.css` and `polished.css`), plus the scales the stylesheets already use: spacing on a 2px grid (`--space-N` is N x 2px), a type scale from 9px to 34px, and radii. Change the look there, not in the other stylesheets. A deliberate one-off can stay if its line carries `design-ok: why` in a comment.

## What it checks

| Check | Flags | Fixed by |
|---|---|---|
| Hard-coded color | hex, `rgb()` and `rgba()` literals in `src/styles/*.css`, including gradients, shadows and local custom properties | code when the color equals a token (with or without alpha), Claude otherwise |
| Off-scale spacing | `padding`, `margin` and `gap` px values that are not on the spacing scale | Claude |
| Off-scale type size | `font-size` px values that are not on the type scale | Claude |
| Font stack | `font-family` that is not `var(--serif)`, `var(--sans)` or `var(--mono)` | Claude |
| Radius | `border-radius` that equals a radius token but is written as px | code |
| Inline style color | literal colors and font stacks in React `style={{ }}` in `src/components` and `src/views` | code or Claude |
| Name | building (`project.name`) and agent names in `catalog/*.yaml` that break the naming scheme | Claude |

The 3D map and office scenes (`src/views/map3d`, `src/views/office`, `src/views/Map.tsx`) are art with their own materials and are not checked.

`baseline.json` records the findings that were already on main when the agent was added, so only drift above it is called **new**. New drift shows up as warnings on the pull request that adds it (the check runs on pull requests in dry-run mode) and in Atlas's feed. Each merged fix pull request removes its findings from the baseline, so the backlog only goes down.

## How it runs

`.github/workflows/design-consistency.yml` runs when styles, components or the catalog change on main, daily at 14:17 UTC, and on demand. Each run:

1. **Check (free).** Reads the files from the checkout, plus one API read to see whether a fix pull request (`design-consistency/*` branch) is already open. Writes the backlog and new drift to the job summary.
2. **Stop** when there is nothing to fix, a fix pull request is still open (one at a time), or the day's 4 fix runs are used.
3. **Fix one batch.** Swaps that cannot change the picture come first, all in one pull request (up to 80): a literal that equals a token becomes `var(--token)`, one with an alpha becomes `color-mix(in srgb, var(--token) N%, transparent)`. No model is called. When none are left, it takes up to 20 findings of one kind, new drift first, and asks Claude (`prompt.md`, model and caps in `policy.json`) for one edit each, as JSON that must match a closed schema. The SDK is installed only for that step. Caps are checked before the call: $1 a month, reserving the worst case first; a failed call still counts.
4. **Verify every edit.** An edit may only use existing tokens or scale values, and the check must stop flagging that line; anything else is listed as not applied and skipped next time. Claude can also say a literal is deliberate, which adds a `design-ok` comment.
5. **Screenshots.** Takes Mission Control, Agents and Repositories before and after the change (`visual/design.visual.ts`, 1x, fixtures, frozen clock) and counts changed pixels. Code-only swaps should show "none".
6. **Pull request.** Pushes the fix to `design-consistency/run-<id>` and the screenshots to the `design-consistency-shots` branch (so images never land on main), opens the pull request with the table of changes and the screenshots, and sends one line to Atlas's feed.

## Setup

Nothing is required for the check: it runs and reports without any secret.

1. **Let the workflow open pull requests.** Tick "Allow GitHub Actions to create and approve pull requests" at https://github.com/khaneilcampbell/ai-ops-atlas/settings/actions (Workflow permissions). The agent only creates; it never approves.
2. **CI on fix pull requests (recommended).** Pull requests opened with the built-in token do not start other workflows. Create a fine-grained token for `khaneilcampbell/ai-ops-atlas` only, with Contents and Pull requests read and write, at https://github.com/settings/personal-access-tokens/new, and save it as `DESIGN_FIX_TOKEN` at https://github.com/khaneilcampbell/ai-ops-atlas/settings/secrets/actions/new. Without it, start CI on a fix pull request by pushing to it or with "Update branch".
3. **Judgment fixes.** Uses the existing `ANTHROPIC_API_KEY` (shared with Merge Flow and Opportunity Scout). Without it, only code-only swaps are made.
4. **Atlas feed (optional).** `ATLAS_FEED_URL` and `ATLAS_FEED_TOKEN`, as for the other GitHub building agents. See `docs/live-updates.md`.

## Limits

- Never merges, approves, pushes to main or changes settings. It writes only to `design-consistency/*` branches and `design-consistency-shots`.
- At most one open fix pull request, 4 fix runs a day, and $1 a month for Claude.
- Screenshots cover three views; a change elsewhere (the inspector panel, office overlays) is reviewed from the diff.

## Runbook

- **Stop it.** Disable the workflow at https://github.com/khaneilcampbell/ai-ops-atlas/actions/workflows/design-consistency.yml, or set `"enabled": false` in `policy.json`.
- **Stop only the Claude call.** Set `model.monthlyBudgetUsd` to 0, or remove `ANTHROPIC_API_KEY` (this also stops the other agents' Claude calls).
- **Don't like a fix.** Close the pull request without merging. Its findings stay in the backlog; mark a line `design-ok: why` to stop it coming back, or change the token.
- **Accept the current state as the new baseline.** `python3 ops/design-consistency/design.py scan --write-baseline` and commit `baseline.json`.
- **Start over.** Delete the `design-consistency-state-*` caches at https://github.com/khaneilcampbell/ai-ops-atlas/actions/caches. This resets the day's runs and the month's spend record.
- **Test locally.** `python3 -m unittest discover -s ops/design-consistency -p 'test_*.py'`, or `python3 ops/design-consistency/design.py scan --dry-run` to see the findings.
