# Local ops and session handoffs

Plain code does the routine checks so a coding session (Claude Code, Codex) spends its tokens on
judgment, not on reading logs and files. Nothing here calls a model or the network.

| Command | What it prints |
| --- | --- |
| `npm run ops` | Branch, ahead/behind `main`, uncommitted and unpushed work, the checks CLAUDE.md asks this change to run, high-risk paths, big files to read in ranges, changelog and JSON problems. Exit code 1 on a problem. |
| `npm run ops -- --run` | The same, then runs lint, typecheck, tests (and `cargo test` when Rust changed) and prints only each failure's last 15 lines. |
| `npm run handoff -- "what's left"` | A markdown handoff under 60 lines: task, commits, changed files by area, checks still to run, the branch preview link. Paste it into a fresh session. |

The rules live in `scripts/ops.mjs` and follow CLAUDE.md; change both together.

## When to start fresh

Every reply re-sends the whole conversation. API Usage → **Where to optimize** lists the Claude Code
and Codex sessions on this Mac that carried a heavy context, from the session logs' token counts:

- **Start fresh sooner** when replies averaged 80k+ prompt tokens (the end of the session was near the
  limit). Run `npm run handoff`, open a new session, paste it.
- **Compact earlier** when replies averaged 40k+ or a session passed 200 replies. Use `/compact`
  between steps of one task.

Thresholds are `SESSION_RULES` in `src/usage/sessions.ts`.
