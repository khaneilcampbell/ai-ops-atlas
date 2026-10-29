# Live updates

The Mac app and the website show workflow runs, pushes and Atlas's own agent runs as they
happen, without a refresh. The header's **Live** pill says whether the feed is flowing and
what it last reported.

## How it works

```
GitHub App "KC Atlas Live" ──webhook──▶ POST /api/hooks/github  (HMAC, GITHUB_WEBHOOK_SECRET)
Mac app (Repository Intelligence) ────▶ POST /api/hooks/atlas   (Bearer USAGE_SYNC_TOKEN)
Commerce pipeline (VPS loop.sh) ──────▶ POST /api/hooks/agents  (Bearer AGENT_FEED_TOKEN)
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

## Pipeline runs (outside Atlas)

Pipelines that run elsewhere report each phase result to `POST /api/hooks/agents`, and Atlas
shows them as the run history of the catalog agents whose manifest has
`observe: { agent_feed: true }`. Today that is the commerce pipeline
(`scripts/atlas_feed.py`, called from `loop.sh`).

One report is one JSON object, at most 4 KB:

```json
{ "project": "commerce-pipeline", "agents": ["seo-maintainer"], "phase": "Phase 6: SEO",
  "status": "ok", "detail": "3 listings refreshed", "at": "2026-10-28T08:00:00+00:00" }
```

- `status` is `ok`, `failed`, `skipped` (the loop is paused) or `paused`. `ok` counts as a
  success and `failed` as a failure; the other two are shown but don't change health.
- `project` and each of the 1 to 10 `agents` are catalog ids (lowercase letters, digits,
  dashes). `phase` is up to 120 characters, `detail` up to 300. Anything else is refused with
  a 400 and nothing is stored.
- `AGENT_FEED_TOKEN` can only add reports. It can't read the feed, so a leaked VPS `.env`
  exposes nothing in Atlas. It is separate from the Mac's sync key.
- The site keeps three days; each browser and the Mac also keep the last 200 reports locally,
  so history outlives the site's pruning on a device that has been open.
- A `failed` report raises an alert in Atlas for agents with an `alerts` block, and can email
  you right away. See [alerts.md](alerts.md).

Setup:

1. Make a key: `openssl rand -hex 32`.
2. Cloudflare → Workers & Pages → ai-ops-atlas → Settings → Variables and Secrets: add
   `AGENT_FEED_TOKEN` (type Secret) with that key, then retry the latest production deployment.
3. On the VPS, add to the pipeline's `.env`:
   `ATLAS_FEED_URL=https://ai-ops-atlas.pages.dev/api/hooks/agents` and
   `ATLAS_FEED_TOKEN=<the same key>`. The existing `/api/hooks/*` login exception covers it.

## Checking it

- GitHub: the app's Advanced tab lists recent deliveries; a 202 means stored, 401 a secret
  mismatch, 503 that the secret or binding isn't on the deployment yet.
- The Live pill's tooltip shows the last check and the latest event.
- Pipeline: `python scripts/atlas_feed.py ok "Loop" "test"` on the VPS prints nothing when
  Atlas stored it, `not sent: HTTP 401` for a key mismatch and `HTTP 503` when the secret isn't
  on the deployment yet. The test shows up under the Autonomous Loop agent.

For scoped per-agent credentials, heartbeats, run duration/cost and stale reporting detection, see [Production reporting](production-observability.md). The existing phase feed remains supported.
