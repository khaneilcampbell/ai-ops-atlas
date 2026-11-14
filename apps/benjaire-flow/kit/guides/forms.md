# Forms: connecting your website

Flow accepts inquiries at one address. Anything that can send an HTTPS POST from a server can use it: the included Cloudflare Worker, your own backend, or a form tool that supports server side webhooks with custom headers.

## The intake contract

    POST https://YOUR-N8N/webhook/flow-intake
    Content-Type: application/json
    x-flow-key: YOUR-INTAKE-KEY

| Field | Required | Notes |
|---|---|---|
| name | Recommended | Up to 120 characters |
| email | Yes | Must be a valid address |
| message | Yes | At least 10 characters, up to 5,000 |
| company | No | Up to 160 characters |
| phone | No | Digits, spaces, + ( ) - and dots |
| source | No | A short label such as website or landing-spring; letters, numbers, dash and underscore |
| website | Must be empty | Hidden honeypot field. Bots fill it; people never see it |

## Responses

| Status | Body | Meaning |
|---|---|---|
| 200 | {"ok":true,"ref":"INQ-..."} | Saved and processed |
| 200 | {"ok":true,"ref":"INQ-...","duplicate":true} | Same email and message within dedupe_minutes; acknowledged, not processed again |
| 401 | {"ok":false,"error":"Unauthorized"} | Missing or wrong x-flow-key |
| 422 | {"ok":false,"error":"..."} | Invalid email, message too short, or honeypot filled |

## Option A: Cloudflare Worker (recommended)

Use 4-website/worker.js with 4-website/contact-form.html. The form posts to /api/contact as a normal form or with fetch. With an Accept: application/json header the Worker answers in JSON; otherwise it redirects to THANK_YOU_URL. Steps are in guides/cloudflare.md.

## Option B: your own server

- Node: 4-website/server-forwarder.js is an Express route you can drop into an existing app.
- PHP: 4-website/server-forwarder.php works on most shared hosting.

Keep the intake key in an environment variable on the server, never in page source.

## Form builders

Tools such as Typeform, Tally or Jotform can post to Flow only if their webhook lets you add the x-flow-key header and map the fields above. If yours cannot, send its webhook to the Worker or your server and forward from there.

## Several forms

Give each form its own source value (for example website, pricing-page, partners). The source is saved with every inquiry and shown in your records.
