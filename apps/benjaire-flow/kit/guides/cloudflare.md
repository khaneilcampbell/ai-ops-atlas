# Cloudflare: the protected form endpoint

4-website/worker.js is a small Cloudflare Worker that sits between your website form and Flow. It keeps the intake key off the page, blocks bots with Turnstile, validates the fields, and if n8n cannot be reached it emails the inquiry to you directly so nothing is lost.

## 1. Create the Worker

1. In Cloudflare, open Workers and Pages, Create, Create Worker. Name it, for example, flow-form.
2. Replace the starter code with the contents of 4-website/worker.js and deploy.

## 2. Add variables and secrets

In the Worker, Settings, Variables and Secrets:

| Name | Type | Value |
|---|---|---|
| FLOW_INTAKE_URL | Text | https://YOUR-N8N/webhook/flow-intake |
| FLOW_INTAKE_KEY | Secret | the intake_key from flow_settings |
| ALLOWED_ORIGINS | Text | your site origins, comma separated, for example https://acme.com,https://www.acme.com |
| THANK_YOU_URL | Text | page to show after a normal form post, for example https://acme.com/thanks |
| TURNSTILE_SECRET_KEY | Secret | optional, from step 3 |
| RESEND_API_KEY | Secret | optional, for the offline fallback |
| FALLBACK_FROM | Text | optional, for example Website <hello@acme.com> |
| FALLBACK_TO | Text | optional, where fallback emails go, usually owner_email |

## 3. Turn on bot protection (recommended)

1. In Cloudflare, open Turnstile, Add widget, and add your domain. Choose Managed mode.
2. Copy the secret key into TURNSTILE_SECRET_KEY.
3. Add the site key to your form as shown in 4-website/contact-form.html.

When TURNSTILE_SECRET_KEY is set, the Worker rejects any submission without a valid Turnstile token. When it is blank, the hidden honeypot field and the origin check still apply.

## 4. Route it to your site

Workers and Pages, your Worker, Settings, Domains and Routes, Add route: yourdomain.com/api/contact. Point your form's action at /api/contact.

If your site is not on Cloudflare, use the workers.dev address the Worker shows, add your site to ALLOWED_ORIGINS, and post the form there.

## 5. Add a rate limit (recommended)

Security, WAF, Rate limiting rules: match the path /api/contact and allow about 5 requests per minute per IP.

## Offline fallback

If n8n returns an error or does not answer within 15 seconds, and RESEND_API_KEY, FALLBACK_FROM and FALLBACK_TO are set, the Worker emails you the inquiry in plain text and still shows the visitor a success message. Fallback emails are not saved in Flow, so add them by hand or ask the sender to resubmit once Flow is back.
