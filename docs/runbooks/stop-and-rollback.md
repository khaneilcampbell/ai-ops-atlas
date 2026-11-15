# Runbook: Stop and roll back the sending and publishing agents

One page for the agents that email people or change what the public sees. Use it when one of them misbehaves: stop it first, then roll back. Per-agent detail lives in [multi-agent-commerce-pipeline.md](multi-agent-commerce-pipeline.md) and [benjaire-com.md](benjaire-com.md).

| Agent | Sends or publishes | Fastest stop | Roll back |
| --- | --- | --- | --- |
| Design Run (n8n) | Canva designs, approval email to Khaneil | Switch "Commerce · Design product" to inactive in n8n | Nothing public to undo |
| Approve and Publish (n8n) | Stripe product, price and payment link | Switch "Commerce · Approve product" to inactive | Deactivate the payment link in Stripe |
| Shop Page (n8n) | Public shop page | Switch "Commerce · Shop page and weekly sales" to inactive | Restore an earlier version in n8n |
| Order Delivery (n8n) | Buyer emails | Switch "Shop · Flow Starter delivery" to inactive | Not reversible; follow up by hand |
| Benjaire Flow Intake | Owner alert, sender acknowledgement | Deactivate "Flow · 1 Intake" in n8n | Not reversible; the Worker still emails `CONTACT_TO` |
| Shop Buyer Follow Ups (n8n) | Day 2, day 12 and download reminder emails to buyers | Switch "Shop · Flow follow ups" to inactive | Not reversible; follow up by hand |
| Contact Form Worker | Email to Benjaire, n8n webhook, Stripe checkout sessions | Roll back the Worker deployment in Cloudflare | Same page, earlier deployment |

## Kill switches (stop without unpublishing)

Each switch is off by default, so leaving it empty keeps today's behaviour. Turn it on to stop the
sends below while everything else keeps running. All switches are live as of 2026-11-15: the four n8n
workflows were published and the benjaire.com Worker switches were merged.

| Switch | Where | What stops | What still happens |
| --- | --- | --- | --- |
| `customer_emails_paused` = true | n8n data table `flow_settings` (newest row) | Flow · 1 Intake acknowledgement to the sender | Inquiry saved, owner alert sent, `ack_paused` event logged |
| `customer_emails_paused` = true | n8n data table `shop_settings` (any row) | Buyer delivery email, day 2 / day 12 follow ups, download reminders | Order saved as not delivered; the owner sale email says to send the link by hand; Atlas gets a `skipped` run |
| `design_runs_paused` = true | n8n data table `shop_settings` (any row) | Commerce · Design product, before any Claude or Canva call | The idea stays queued for the next run |
| `CONTACT_PAUSED` = 1 | Cloudflare → Workers & Pages → `benjaire-com` → Settings → Variables and Secrets (type **Secret**) | Inquiry email, Flow forward, Atlas inbox copy | The form tells visitors it is paused; Atlas gets a `skipped` run |
| `CHECKOUT_PAUSED` = 1 | Same place as `CONTACT_PAUSED` | Every Stripe API call from the Worker | Buyers go to the tier's Payment Link; deactivate those in Stripe to stop sales completely |

Data tables: https://khancam15.app.n8n.cloud/projects/qhAhqRqO8TimFtxs/datatables. Use the Secret
type for the Worker switches: plain-text variables that are not in `wrangler.jsonc` are dropped by
the next deploy. To turn a switch off, clear the cell (or delete the secret).

## Caps that are always on

| Agent | Cap |
| --- | --- |
| Contact Form Worker | 5 a minute per visitor and 20 a minute site-wide, for contact and for checkout; email only to verified Email Routing addresses |
| Shop Buyer Follow Ups | A run with more emails due than `followup_max_per_run` (default 5) sends none, reports to Atlas and emails Khaneil |
| Design Run | At most 2 new designs per 7 days, one per run, 3 attempts per idea |
| Approve and Publish | Only from Khaneil's approval form with a one-time token; idempotency keys on every Stripe write |
| Product Lab Lead | n8n agent budget $3 a month, $1.50 a session, 5 web searches a run |

## Commerce pipeline (n8n)

All commerce workflows live in the "Commerce" folder on n8n Cloud. Per-workflow detail is in [multi-agent-commerce-pipeline.md](multi-agent-commerce-pipeline.md).

**Stop.** Open the workflow in n8n and switch it to inactive. Stopping "Shop · Flow Starter delivery" also stops buyer emails, so paying buyers wait until it is active again.

**A product went live that shouldn't have.** In Stripe, open [Payment links](https://dashboard.stripe.com/payment-links), find the product and choose **Deactivate**. The checkout stops taking money right away. Then check that the shop page no longer offers it.

**A workflow change made things worse.** Open the workflow's version history in n8n and restore the last good version.

**A buyer got a wrong or duplicate email.** Emails can't be recalled. Check the order in n8n executions and reply to the buyer by hand.

## Benjaire.com

**Benjaire Flow Intake (n8n).** Stop: in n8n Cloud, open the "Flow · 1 Intake" workflow and switch it to inactive. The contact Worker keeps emailing every inquiry to `CONTACT_TO`, so no inquiry is lost. Roll back: open the workflow's version history in n8n and restore the last good version, or import `apps/benjaire-flow/live-ops/workflows/1-intake.json`. Acknowledgements already sent can't be recalled.

**Contact Form Worker (Cloudflare).** Stop or roll back in Cloudflare → Workers & Pages → `benjaire-com` → Deployments: pick the last good deployment and roll back to it. To stop all sends, remove the Worker's mail secrets there; the form then answers 503.

## After any stop

Write down what happened, what was rolled back and what was sent, in the agent's section of its runbook under "When it fails", so the next stop is faster.
