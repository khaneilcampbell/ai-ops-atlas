# Runbooks: Benjaire.com

Repository: [khaneilcampbell/benjaire.com](https://github.com/khaneilcampbell/benjaire.com). The site's own setup notes are in `site/README.md`; the Flow workflow export and its notes are in the private `khaneilcampbell/benjaire-dashboard` repository under `products/flow/live-ops/`.

## Contact Form Worker

`site/worker/index.ts`, deployed as the `benjaire-com` Worker by Cloudflare Workers Builds on each push to `main`. Handles `POST /api/contact` and `GET /api/checkout`.

- **Healthy:** a test message from https://benjaire.com/contact reaches the inbox in `CONTACT_TO`, and Flow sends its acknowledgement. Cloudflare → Workers → `benjaire-com` → Logs shows no `send_email failed`, `Flow intake` or `Stripe checkout failed` errors.
- **Run it locally:** create `site/.dev.vars` with Cloudflare's always-pass Turnstile test secret and `CONTACT_TO`, then `cd site && npx wrangler dev`. Unit tests: `npm run test:worker`.
- **When it fails:**
  - `503 The form is temporarily unavailable`: the `CONTACT_TO` secret is missing.
  - `502 Your message couldn't be sent`: Email Routing refused; the destination must be a verified address.
  - Robot check failures for everyone: the `TURNSTILE_SECRET_KEY` secret doesn't match the widget.
  - Email arrives but Flow doesn't: check `FLOW_INTAKE_URL` and `FLOW_INTAKE_KEY`. The forward is tried once with a 10 second timeout and only logged on failure, so the email is the record.
  - Buy buttons land on a Payment Link instead of Checkout: `STRIPE_SECRET_KEY` is missing, the tier has no price, the rate limit was hit, or Stripe errored. Buyers can still pay.
- **Stop it:** remove the secrets in Cloudflare → Workers → `benjaire-com` → Settings → Variables and secrets (the form then answers 503), or roll back to an earlier deployment there.

## Benjaire Flow Intake

The n8n Cloud workflow "Flow · 1 Intake" (`POST /webhook/flow-intake`). Export: `products/flow/live-ops/workflows/1-intake.json` in `benjaire-dashboard`.

- **Healthy:** each inquiry adds a `flow_inquiries` row and a `flow_events` row in n8n, the owner gets an alert and the sender an acknowledgement. Error alerts from "Flow · 0 Error alerts" go to `ops_email`.
- **Run it:** submit the site's contact form, or `POST` the documented JSON with the `x-flow-key` header (see `live-ops/README.md`).
- **When it fails:** `401` means the key sent by the Worker doesn't match the newest `flow_settings` row's `intake_key`. If Claude fails, the inquiry is still saved and alerted without AI fields. Email problems are on Resend (free plan: 100 a day).
- **Stop it:** deactivate the workflow in n8n. The Worker keeps emailing inquiries to `CONTACT_TO`, so nothing is lost.
- **Change it:** edit in n8n, then export it over `1-intake.json` so the repository stays current.

## Site CI

`.github/workflows/site-ci.yml`. Required check on `main`.

- **Healthy:** latest run on `main` is green.
- **When it fails:** reproduce in `site/` with `npm ci && npm run ci`; accessibility tests also need `npx playwright install chromium` and `npm run test:a11y`. A Node version error means the runner's Node is older than Astro needs; the workflow already sets `check-latest: true`.
- **Stop it:** disable the workflow in Actions. Because it is a required check, pull requests can't merge while it's off.
