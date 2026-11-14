# Benjaire Flow v1.0.1: setup guide

Flow turns your website contact form into a managed inquiry pipeline that runs in your own n8n. Every inquiry is checked, sorted by Claude, saved, and sent to you with a suggested reply and one tap status buttons. The sender gets a branded acknowledgement, you get a reminder before anyone waits too long, and every Monday you get a short digest.

Typical first setup takes 45 to 90 minutes.

## What is in this download

New here? Open **00-START-HERE.pdf** first. It is this guide as a three page checklist. The folders are numbered in the order you set Flow up.

    00-START-HERE.pdf                 the guide and checklist (start here)
    README.md                         this setup guide in plain text
    CHANGELOG.md                      what changed in each version
    LICENSE.txt
    1-tables/                         step 2: the three data table schemas
    2-presets/                        step 3: 4 ready settings rows for common businesses
    3-workflows/0-error-alerts.json   step 4: emails you if any Flow workflow fails
    3-workflows/1-intake.json         receives, checks, sorts, saves and answers inquiries
    3-workflows/2-status-updates.json the status buttons in your alert emails
    3-workflows/3-reply-reminders.json weekday reminders for unanswered inquiries
    3-workflows/4-monday-digest.json  weekly summary every Monday morning
    3-workflows/5-data-retention.json optional daily cleanup of old records
    4-4-website/worker.js               step 5: Cloudflare Worker form endpoint (bot protection, offline fallback)
    4-website/contact-form.html       a minimal contact form
    4-website/server-forwarder.js     forward from your own Node server instead of Cloudflare
    4-website/server-forwarder.php    the same for PHP sites
    5-test/curl-test.sh               step 6: send a test inquiry from a terminal
    5-test/test-checklist.md          the 17 checks before you go live
    guides/                           Cloudflare, email, forms, architecture, troubleshooting, security

## What you need first

- n8n, Cloud or a recent self hosted version that includes Data tables.
- An Anthropic API key (console.anthropic.com). Claude sorts each inquiry for a fraction of a cent.
- A Resend account (resend.com) with your sending domain verified, and an API key. See guides/email.md.
- A sending address on your own domain with SPF, DKIM and DMARC set up.
- Optional: a Cloudflare account for the protected form endpoint. See guides/cloudflare.md.

## Step 1. Create the credentials in n8n

1. Credentials, Create, **Bearer Auth**. Name it **Resend API** and paste your Resend API key as the token.
2. Credentials, Create, **Anthropic**. Name it **Anthropic** and paste your Anthropic API key.

## Step 2. Create the three data tables

In n8n open Data tables and create these tables with exactly these names. The quickest way is to create each one from the matching CSV in the 1-tables folder, then delete the sample row.

**flow_settings**: all text, except these numbers: logo_width, logo_height, reply_sla_hours, urgent_sla_hours, dedupe_minutes, token_ttl_days, retention_days.

**flow_inquiries**: text: inquiry_ref, name, email, company, phone, message, source, topic, urgency, budget, summary, suggested_reply, status, action_token, dedupe_key. Date: received_at, reply_due_at, token_expires_at, status_changed_at. Boolean: is_spam, reminded.

**flow_events**: text: inquiry_ref, event, detail. Date: at.

Keep exactly one row in flow_settings.

## Step 3. Fill in your settings

Start from the preset closest to your business in the 2-presets folder (accounting firm, law firm, design studio or IT consultancy), or from 1-tables/flow_settings.csv. Then edit the row:

| Column | What to enter |
|---|---|
| firm_name | Your business name, as clients should see it |
| owner_email | Where inquiry alerts, reminders and the digest go |
| ops_email | Where error alerts go (can match owner_email) |
| from_address | Sender for every email, for example: Acme Advisory <hello@acme.com>. The domain must be verified in Resend |
| reply_to_email | Where client replies should land |
| public_email | Email shown in the footer of client emails |
| website_url | Your website, for example https://acme.com |
| brand_address | Optional footer line, for example: Austin, TX |
| logo_url | Optional public PNG of your logo for a dark header. Blank shows your name in text |
| logo_width, logo_height | Logo size in pixels, for example 152 and 24 |
| services | Your services, separated by semicolons. Claude labels each inquiry with the closest one |
| booking_link | Optional booking page (Calendly, Cal.com and so on) |
| booking_cta_label | Button text, for example: Book a free call |
| booking_note | Small line under the button, for example: Free, 30 minutes, on Zoom. |
| onboarding_docs | What a new client should send you, separated by semicolons. Used in the welcome email |
| reply_sla_hours | Hours before a normal inquiry gets a reminder, for example 24 |
| urgent_sla_hours | Hours for urgent inquiries, for example 4 |
| dedupe_minutes | Window in which an identical resubmission is ignored, for example 10 |
| token_ttl_days | Days the status buttons keep working, 30 by default |
| retention_days | Days to keep records. 0 or blank keeps everything and leaves Flow 5 off |
| n8n_base_url | Your n8n address with no trailing slash, for example https://yourname.app.n8n.cloud |
| intake_key | A long random secret, 32 characters or more. Your form endpoint sends it with each inquiry |

To make an intake key, run this in a terminal, or use any password generator:

    openssl rand -hex 24

## Step 4. Import the workflows

Import the six files in 3-workflows in order, 0 to 5 (Workflows, Create, then the menu, Import from file). In each workflow:

1. Open each node with a warning icon and choose your **Resend API** or **Anthropic** credential.
2. In Flows 1 to 5, open Settings and set **Error workflow** to **Flow · 0 Error alerts**.
3. Set **Timezone** in Settings to your own time zone. Reminders, the digest and retention run on it.

Publish Flow 0 first, then Flows 1 to 4. Publish Flow 5 only if you want automatic cleanup.

## Step 5. Connect your website form

Your intake address is:

    https://YOUR-N8N/webhook/flow-intake

Never put the intake key in browser code. Use one of these:

- **Cloudflare Worker (recommended).** 4-website/worker.js adds bot protection with Turnstile, checks the form and emails you the inquiry directly if n8n cannot be reached. Steps in guides/cloudflare.md.
- **Your own server.** 4-website/server-forwarder.js (Node) or 4-website/server-forwarder.php.

The field contract and responses are in guides/forms.md.

## Step 6. Test it

Run 5-test/curl-test.sh, then work through the 17 scenarios in 5-test/test-checklist.md. The first test should give you an owner alert within a minute and an acknowledgement at the test address. Click **Close: no deal** in the alert to clear it.

## Day to day

- **New inquiry alert.** Summary, urgency, budget and a suggested reply for you to review. Flow never sends an AI written reply to a prospect.
- **I replied to them.** Stops reminders. Nothing is sent to the client.
- **Became a client.** Sends your welcome and onboarding email the first time.
- **Close: no deal.** For no reply, went elsewhere, or a test. Nothing is sent.
- **Reminders.** Weekdays at 9am, 1pm and 5pm, once per inquiry past its reply target.
- **Monday digest.** Every Monday at 8am: new inquiries, wins, losses, time to handle and who is still waiting.

All inquiry data stays in your own n8n.

## Help

Problems are covered in guides/troubleshooting.md. For setup help, reply to your download email with the step number and what you see. Starter includes setup help by email for 14 days after purchase; Professional includes email support for 60 days and a 45 minute setup call. Bug fix updates to v1.x are included for 12 months; CHANGELOG.md lists what each update changed.
