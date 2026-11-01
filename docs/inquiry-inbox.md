# Client inquiries (Inquiry to Client)

Every inquiry sent through the benjaire.com contact form shows up in **Mission Control →
Client inquiries**. For each one, Atlas drafts a reply, then reminds you to follow up on day 3
and day 7 after you reply. It never sends anything. **Draft reply** copies the reply in the
Benjaire email design (the same look as the automatic "We received your message" email) and opens a
Gmail compose window with the recipient and subject filled in. Click in the message, press ⌘V, edit
if you like, and press Send. The design lives in `src/inquiries/emailHtml.ts`, ported from the n8n
Flow intake. If the browser blocks the clipboard, Gmail opens with the plain text instead.

## Sending from Atlas

When the site has `RESEND_API_KEY`, `REPLY_FROM` and `REPLY_BCC` set (Pages → Settings → Variables
and Secrets), **Draft reply** opens an editor instead: To, Subject, the message, and a preview of
the designed email exactly as the client will get it. **Send to …** sends it from `REPLY_FROM` and
puts a copy in the `REPLY_BCC` Gmail inbox. Nothing is ever sent without that press.

- The address comes from the stored inquiry, never from the request, so Atlas can only answer people
  who wrote in. Optional `REPLY_REPLY_TO` sets where the client's answer goes.
- A retried tap sends once (each editor has one key, also passed to Resend as an idempotency key).
- Safety limit: 50 replies in 24 hours. Sent replies are logged in the `inquiry_replies` table.
- Mac app: `live_inquiry_reply` posts to `/api/hooks/inquiries/reply` with the sync key. The web page
  posts to `/api/inquiries/reply` behind Access.
- Not set up, or a send fails: **Use Gmail instead** (or the old Draft reply flow) still works.

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
