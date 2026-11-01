# Client inquiries (Inquiry to Client)

Every inquiry sent through the benjaire.com contact form shows up in **Mission Control →
Client inquiries**. For each one, Atlas drafts a reply, then reminds you to follow up on day 3
and day 7 after you reply. It never sends anything. **Draft reply** opens your own mail app with
the draft filled in, and you edit and press Send there.

Running cost: $0. No model calls. It uses the existing Pages site and its D1 database.

## How it flows

```
benjaire.com contact form ─▶ contact Worker ─▶ owner email (unchanged)
                                            ├─▶ Benjaire Flow in n8n (unchanged)
                                            └─▶ POST /api/hooks/inquiries (Bearer ATLAS_FEED_TOKEN)
                                                     │  D1 table inquiries, 180 days
                         ┌───────────────────────────┴──────────────────────────┐
             GET /api/inquiries (Access)                      GET /api/hooks/inquiries (sync key)
                  signed-in page                                       Mac app
```

- The Worker derives the inbox URL from its `ATLAS_FEED_URL` (`…/api/hooks/agents` becomes
  `…/api/hooks/inquiries`) and uses the same `ATLAS_FEED_TOKEN`. That token is the site's
  add-only `AGENT_FEED_TOKEN`: it can store an inquiry but never read one.
- Each inquiry has an id from the Worker, so a retried copy is stored once.
- Inquiries older than 180 days are deleted.
- The live feed gets an `inquiry` event with the category only, never a name or email, so an
  open page refreshes as soon as one lands.
- Replied, follow-ups sent, and closed are kept on each device (`atlas:inquiryProgress`).

## What you need to turn it on

1. Merge the Atlas pull request and the benjaire.com pull request.
2. The contact Worker needs `ATLAS_FEED_URL` (`https://ai-ops-atlas.pages.dev/api/hooks/agents`)
   and `ATLAS_FEED_TOKEN` (the same value as the site's `AGENT_FEED_TOKEN`) in its Cloudflare
   settings. If it already reports runs to Atlas, nothing else is needed.
3. The Mac app reads the inbox through website sync (Settings → Website sync), like the live feed.

## Turning it off

Remove `ATLAS_FEED_URL` or `ATLAS_FEED_TOKEN` from the Worker, or revert the pull requests. The
owner email and Benjaire Flow keep working either way.

## Checks

- `src/inquiries/model.test.ts` and `server/inquiries.test.ts`.
- Screenshots: `npx playwright test -c visual/inquiries.config.ts` (hosted web build on port
  4183), into `visual/out/inquiries-*.png`.
