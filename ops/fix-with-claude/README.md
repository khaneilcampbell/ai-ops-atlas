# Fix with Claude

One button in Atlas that hands a problem to Claude Code, which reproduces it, fixes it in one small
pull request and reports back. KC still merges.

## How it works

1. KC presses **Fix with Claude** next to an item in Mission Control (a failing workflow, a failing or
   silent agent, a manifest problem, a repository that needs a look).
2. Atlas opens a pre-filled GitHub issue in `khaneilcampbell/ai-ops-atlas`, labeled `claude-fix`, with
   the item's title, detail, repository and links. Nothing is sent until KC presses **Create** in the
   browser. That press is the approval. Atlas holds no token for this and makes no write call.
3. A Claude Code scheduled task on KC's account listens for `issues.labeled` on that repository. Its
   short saved prompt ([routine.md](routine.md)) checks that `khaneilcampbell` added the label, then
   follows [prompt.md](prompt.md), the senior design engineer prompt, from `main`.
4. Claude opens one pull request that says `Fixes #<issue>`, or comments on the issue why it stopped.

The issue list at https://github.com/khaneilcampbell/ai-ops-atlas/issues?q=label%3Aclaude-fix is the
log of every request.

## Why this shape

- **No new infrastructure in Atlas.** No new token, Keychain entry, Rust command or workflow. The
  button is a link, so it works the same in the Mac app, the web page and on the iPhone.
- **Approval stays with KC.** The browser's Create button is the confirmation, and the label can only be
  set by someone with triage rights on the repository, so a stranger opening an issue on the public
  repository cannot start a run. The saved prompt also checks who added the label.
- **Cost.** Runs use KC's Claude plan, not API credit. One run per press; the prompt forbids loops and
  allows at most two attempts at a failing check.
- **Versioned.** `prompt.md` changes only by pull request, and every run reads it from `main`.

## One-time setup (KC)

1. Create the label: https://github.com/khaneilcampbell/ai-ops-atlas/labels, **New label**, name
   `claude-fix`. Without it the button's issue opens without the label and nothing runs.
2. Create the scheduled task: https://claude.ai/code/routines, **New**. Name it `Atlas: Fix with Claude`.
   Paste the text under the line in [routine.md](routine.md) as the prompt. Repositories:
   `khaneilcampbell/ai-ops-atlas`, plus any other repository you want fixes for. Trigger: **GitHub
   event**, repository `khaneilcampbell/ai-ops-atlas`, event **Issue → labeled**. Remove connectors it
   does not need (GitHub is enough).

To pause it, switch the task off on its page. To change how Claude works, change `prompt.md` in a pull
request.

## Limits

- Repositories that are not in the scheduled task get a comment asking to add them, not a fix.
- Changes to signing, the updater, secrets, CI workflows and write actions are never made without KC's
  written OK on the issue; Claude posts a plan instead.
- GitHub limits a new-issue link to a few thousand characters, so Atlas keeps the issue body short and
  links to the evidence instead of pasting logs.
