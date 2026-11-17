# Runbooks: Benjaire.com

Repository: [khaneilcampbell/benjaire.com](https://github.com/khaneilcampbell/benjaire.com). The site's own setup notes are in `site/README.md`; the Flow workflow export and its notes are in Atlas under `apps/benjaire-flow/live-ops/`.

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

The n8n Cloud workflow "Flow · 1 Intake" (`POST /webhook/flow-intake`). Export: `apps/benjaire-flow/live-ops/workflows/1-intake.json`.

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

## Flow Error Alerts

The n8n Cloud workflow [Flow · 0 Error alerts](https://khancam15.app.n8n.cloud/workflow/F4A9rMTqPZunNoqb), set as the error workflow on every Flow and Shop workflow (and on Atlas · Data Inventory). Export: `apps/benjaire-flow/live-ops/workflows/0-error-alerts.json`.

- **Healthy:** each failed execution elsewhere has a matching run here in mode `error`, and the ops address got the email. Example: execution 731 alerted one second after Data Inventory failed on 2026-11-16.
- **Run it:** it only runs when another workflow fails. To test, run it by hand in n8n (execution 723 on 2026-11-16 was such a test).
- **When it fails:** a failure here is silent by design, so check its Executions after any failure you hear about another way. Email problems are on Resend (free plan: 100 a day).
- **Stop it:** unpublish it in n8n. Failures elsewhere then go unreported, so prefer fixing it.

## Flow Status Updates

[Flow · 2 Status updates](https://khancam15.app.n8n.cloud/workflow/7ccL2o9ta9CNY3gj): `GET /webhook/flow-status` shows a confirm page only; `POST /webhook/flow-status-confirm` checks the inquiry ref and one-time token, changes the status, logs a `flow_events` row and, on a first win, sends the welcome email. Export: `2-status-updates.json`.

- **Healthy:** a status click from an owner alert shows the confirm page, and confirming changes the row in `flow_inquiries`.
- **When it fails:** an invalid-link page means the token or ref doesn't match the row. Error alerts name the failed step.
- **Note:** no execution has been saved since 2026-10-18, so it has not been exercised recently. Test it with the next real inquiry.
- **Stop it:** unpublish it in n8n. Status links then stop working; statuses can still be changed in the n8n data table.

## Flow Reply Reminders

[Flow · 3 Reply reminders](https://khancam15.app.n8n.cloud/workflow/FXEm2O630Yw6h1iw): weekdays at 9am, 1pm and 5pm New York time, one email per inquiry still `new` past its reply target (24 hours, 4 urgent, from `flow_settings`).

- **Healthy:** three successful runs every weekday in Executions. The Missed Run Check emails ops if a run is late.
- **When it fails:** Error alerts name the step. A reminder nobody needed means the inquiry's status wasn't updated; use its status link.
- **Stop it:** unpublish it in n8n.

## Flow Monday Digest

[Flow · 4 Monday digest](https://khancam15.app.n8n.cloud/workflow/WWLpiSncbo2SLS5M): Mondays at 8am New York time, emails the owner the week's new, won and lost inquiries, median handling time and who is waiting.

- **Healthy:** one successful run every Monday (execution 732 on 2026-11-16).
- **When it fails:** Error alerts name the step; run it by hand in n8n after fixing.
- **Stop it:** unpublish it in n8n.

## Flow Missed Run Check

[Flow · 5 Missed run check](https://khancam15.app.n8n.cloud/workflow/u3B7KFesmHzyEimO): daily at 11am New York time, reads the recent runs of Shop follow ups, Reply reminders and the Monday digest and emails ops about any that missed their schedule. No AI.

- **Healthy:** one successful run a day and no email unless something is late.
- **When it fails:** it uses a read-only n8n API key; a `401` means that key was revoked or expired. Replace it in the workflow's credential.
- **Stop it:** unpublish it in n8n. Silent schedule failures then go unnoticed.

## Inquiry to Client

Atlas Mission Control (`/api/hooks/inquiries` into the site's D1 `inquiries` table). Details in [docs/inquiry-inbox.md](../inquiry-inbox.md).

- **Healthy:** each contact form inquiry appears once in Mission Control with a drafted reply and day 3 and day 7 follow-ups.
- **When it fails:** an inquiry missing from Mission Control but in the inbox means the Worker's `ATLAS_FEED_TOKEN` copy failed; the email is still the record. Retried copies are ignored on purpose.
- **Stop it:** remove `ATLAS_FEED_TOKEN` from the `benjaire-com` Worker. Nothing is ever sent from Atlas, so stopping it only hides the list.

## Product Lab

The n8n agent "Benjaire Marketing Agency – Product Lab Lead" with five skills (Market Research, Competitor Analysis, Customer Insight, Product Scoring, Product Brief). Details in [docs/product-lab.md](../product-lab.md).

- **Healthy:** on the 1st of each month at 9am New York time a brief reaches benjaireco@gmail.com and a Notion page is saved. The last recorded run is a test on 2026-11-11; the first scheduled run is 2026-12-01.
- **Run it:** ask the agent in n8n chat, or run the task "Monthly next-product report" by hand.
- **When it fails:** check the agent's Sessions in n8n. A budget stop means the $3 a month or $1.50 a session cap was hit. Gmail or Notion errors mean the credential needs signing in again.
- **Stop it:** switch the monthly task off, or unpublish the agent, in n8n.

## Client Inquiry Manager

An owning agent with no model or runtime of its own. It is healthy when its automations are: Contact Form Worker, Benjaire Flow Intake, Inquiry to Client, Flow Status Updates, Flow Reply Reminders and Flow Monday Digest (sections above). Atlas shows its health as the worst of theirs. To stop it, stop the automation that is misbehaving.

## Shop Order Manager

An owning agent with no model of its own. Its automations are Shop Starter Delivery and Shop Buyer Follow Ups; their runbooks are [Order Delivery](multi-agent-commerce-pipeline.md#order-delivery) and [Buyer Follow Ups](multi-agent-commerce-pipeline.md#buyer-follow-ups). Buyer emails can be held without unpublishing with `shop_settings.customer_emails_paused = true` (see [stop-and-rollback.md](stop-and-rollback.md)).

## Business Operations Monitor

An owning agent with no model of its own. Its automations are Site CI, Flow Error Alerts and Flow Missed Run Check (sections above). If an error email or a missed-run email arrives, follow the runbook of the workflow it names.
