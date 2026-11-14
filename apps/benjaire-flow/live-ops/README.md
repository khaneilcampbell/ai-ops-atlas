# Benjaire Flow

Inquiry-to-client automation for small service firms, running on n8n Cloud.
A website inquiry is checked, sorted by Claude, saved, and turned into an owner alert
(with a suggested reply and one-click status buttons) plus an acknowledgement to the sender,
all sent from `contact@benjaire.com`.

## Workflows (`workflows/`)

| File | n8n workflow | Trigger | What it does |
|---|---|---|---|
| `1-intake.json` | Flow · 1 Intake | `POST /webhook/flow-intake` | Checks `x-flow-key`, cleans fields, honeypot check, Claude classification, saves the inquiry, alerts the owner, acknowledges the sender |
| `2-status-updates.json` | Flow · 2 Status updates | `GET /webhook/flow-status`, `POST /webhook/flow-status-confirm` | GET shows a confirm page only; POST verifies ref + one-time token, updates status, logs it, sends the welcome email on a first win |
| `3-reply-reminders.json` | Flow · 3 Reply reminders | Cron `0 8-20/2 * * 1-5` (New York) | One reminder per inquiry still `new` past its reply target |
| `4-monday-digest.json` | Flow · 4 Monday digest | Cron `0 8 * * 1` (New York) | Weekly summary: new, won, lost, median handling time, who is waiting |
| `0-error-alerts.json` | Flow · 0 Error alerts | Error Trigger | Error workflow for 1–4; emails ops with no customer data |

Import: n8n → Workflows → Import from file. After import, reattach the credentials below,
publish `0-error-alerts` first, then set it as the error workflow on 1–4 and publish those.

## Credentials (create in n8n, never commit)

| Name | Type | Used by |
|---|---|---|
| `Resend API` | HTTP Bearer Auth, token = Resend API key (sending access, benjaire.com only) | All email nodes |
| Anthropic | n8n managed Claude credits (or your own Anthropic key) | Intake → Classify with Claude |

Model: `claude-haiku-5-5`, about $0.0004 per inquiry.

## Data tables

**flow_settings**: settings are versioned. Add a new row to change anything; every workflow
reads the newest row (`orderBy id DESC`, limit 1).

| Column | Example / notes |
|---|---|
| firm_name | Benjaire |
| owner_email | Where alerts, reminders and digests go (send directly, not to the forwarded address, to avoid Gmail dedupe) |
| ops_email | Where error alerts go |
| from_address | `Benjaire <contact@benjaire.com>` |
| reply_to_email | contact@benjaire.com |
| booking_link | Calendly link |
| n8n_base_url | https://khancam15.app.n8n.cloud (needed for status buttons) |
| reply_sla_hours / urgent_sla_hours | 24 / 4 |
| services | Comma separated list Claude chooses topics from |
| onboarding_docs | Semicolon separated list for the welcome email |
| intake_key | Shared secret for `x-flow-key`. Generate with `openssl rand -hex 24`. Never commit |
| ai_enabled | Reserved |

**flow_inquiries**: inquiry_ref, received_at, name, email, company, phone, message, source,
topic, urgency, budget, summary, suggested_reply, is_spam, status (`new|replied|won|lost|spam`),
reply_due_at, reminded, action_token, status_changed_at.

**flow_events** (audit log): inquiry_ref, event, detail, at.

## Email setup (free tier)

Sending: **Resend** free plan (3,000/month, 100/day), domain `benjaire.com` verified.
- `resend._domainkey` TXT (DKIM, signs as benjaire.com)
- `rsend.benjaire.com` and `send.benjaire.com` CNAME to Resend (custom bounce/return-path domain, gives SPF alignment)
- `_dmarc` TXT already set by Cloudflare DMARC Management (`p=none`, reports in Cloudflare → Email → DMARC Management). Keep only one `_dmarc` record.

Receiving: **Cloudflare Email Routing** forwards `contact@benjaire.com` to the owner Gmail.
- Apex MX `route1/2/3.mx.cloudflare.net`
- Apex SPF `v=spf1 include:_spf.mx.cloudflare.net ~all`. Keep a single apex SPF record; Resend's SPF lives on `send.` so the apex does not change.

Gmail "Send mail as" `contact@benjaire.com` (done) so manual replies also come from contact@:
SMTP `smtp.resend.com`, port 465 (SSL), user `resend`, password = a separate Resend API key.

Verified 2026-10-16: SPF, DKIM and DMARC all PASS at Gmail. After a few clean weeks of DMARC reports, consider `p=quarantine`.

## Intake API

```
POST https://khancam15.app.n8n.cloud/webhook/flow-intake
x-flow-key: <intake_key>
Content-Type: application/json

{"name":"…","email":"…","company":"…","phone":"…","message":"…","source":"website","website":""}
```
Responses: `200 {ok, ref}`, `401` bad key, `422` invalid inquiry. `website` is a hidden honeypot and must be empty.
The key must be sent server side (e.g. from the site's contact-form Worker), never from browser JavaScript.

## Running costs

| Item | Cost |
|---|---|
| n8n Cloud Starter (after trial) | about €20–24/month |
| Resend | free up to 3,000 emails/month |
| Cloudflare Email Routing | free |
| Claude Haiku | about $0.0004 per inquiry |
