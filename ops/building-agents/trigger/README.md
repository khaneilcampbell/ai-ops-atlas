# Building agents trigger

A Cloudflare Worker whose Cron Trigger starts the **Building agents** workflow every quarter hour
(UTC) for the checks that are due: Signal Watch at :15 and :45, Marketplace Steward on the hour,
Dataset Census on the hour every three hours. GitHub's own `schedule` trigger delivered about one
run in six in November 2026, which made these agents look stale in Atlas.

The Worker sends `workflow_dispatch` only. It has no route, no public URL and one secret.

## Deploy

1. Create a fine-grained GitHub token: repository `khaneilcampbell/ai-ops-atlas` only,
   permission **Actions: Read and write**, nothing else.
2. From this folder: `npx wrangler deploy`
3. `npx wrangler secret put GITHUB_DISPATCH_TOKEN` and paste the token.

## Check it

- Cloudflare dashboard → Workers → `atlas-building-agents-trigger` → Logs shows each run.
- GitHub → Actions → Building agents lists runs with event `workflow_dispatch` every 15 to 30 minutes.

## Pause or roll back

Pause: in the Worker's settings, remove the Cron Trigger, or run `npx wrangler delete`. The
workflow's GitHub schedule keeps running as before. Revoking the token stops dispatches at once.
