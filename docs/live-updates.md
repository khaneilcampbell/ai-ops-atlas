# Live updates

The Mac app and the website show workflow runs, pushes and Atlas's own agent runs as they
happen, without a refresh. The header's **Live** pill says whether the feed is flowing and
what it last reported.

## How it works

```
GitHub App "KC Atlas Live" ──webhook──▶ POST /api/hooks/github  (HMAC, GITHUB_WEBHOOK_SECRET)
Mac app (Repository Intelligence) ────▶ POST /api/hooks/atlas   (Bearer USAGE_SYNC_TOKEN)
                                              │
                                     D1 database atlas-live (binding LIVE)
                                              │
website  ◀── GET /api/events?after=N     (Cloudflare Access, every 5 s while visible)
Mac app  ◀── GET /api/hooks/feed?after=N (Bearer USAGE_SYNC_TOKEN, same cadence)
```

- Only a compact summary of each event is stored (run id, name, status, branch, times, link;
  commit sha, first line, author). Events are kept for three days.
- Clients patch the runs and commits they already show; no GitHub request is made for an
  event. The 30-minute background refresh still runs and reconciles everything else.
- If a client was away long enough to miss more than one page of events, it does a normal
  refresh instead.
- Agent runs on the website come only from the Mac app while it is open. Nothing is simulated.
- The `/api/hooks/*` routes skip the Access login, so each checks its own secret and refuses
  everything without it.

## Setup

1. **GitHub App.** Settings → Developer settings → GitHub Apps → New. Webhook URL
   `https://ai-ops-atlas.pages.dev/api/hooks/github`, a random webhook secret
   (`openssl rand -hex 32`), permissions Actions: read and Contents: read, events
   Workflow run, Workflow job and Push, "Only on this account".
2. **Install** the app on All repositories.
3. **Secret.** Cloudflare → Workers & Pages → ai-ops-atlas → Settings → Variables and Secrets:
   add `GITHUB_WEBHOOK_SECRET` (type Secret) with the same value.
4. **Database.** Same page → Bindings → Add → D1 database: variable name `LIVE`, database
   `atlas-live`.
5. **Login exception.** Zero Trust → Access → Applications → the usage-sync bypass app → add
   the destination `ai-ops-atlas.pages.dev/api/hooks/*`.
6. Redeploy production (Deployments → latest → Retry deployment) so the function sees the new
   secret and binding.

The Mac app uses the website sync URL and key it already has; nothing to set there.

## Checking it

- GitHub: the app's Advanced tab lists recent deliveries; a 202 means stored, 401 a secret
  mismatch, 503 that the secret or binding isn't on the deployment yet.
- The Live pill's tooltip shows the last check and the latest event.
