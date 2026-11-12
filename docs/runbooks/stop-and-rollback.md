# Runbook: Stop and roll back the sending and publishing agents

One page for the agents that email people or change what the public sees. Use it when one of them misbehaves: stop it first, then roll back. Per-agent detail lives in [multi-agent-commerce-pipeline.md](multi-agent-commerce-pipeline.md) and [benjaire-com.md](benjaire-com.md).

| Agent | Sends or publishes | Fastest stop | Roll back |
| --- | --- | --- | --- |
| Design Run (n8n) | Canva designs, approval email to Khaneil | Switch "Commerce · Design product" to inactive in n8n | Nothing public to undo |
| Approve and Publish (n8n) | Stripe product, price and payment link | Switch "Commerce · Approve product" to inactive | Deactivate the payment link in Stripe |
| Shop Page (n8n) | Public shop page | Switch "Commerce · Shop page and weekly sales" to inactive | Restore an earlier version in n8n |
| Order Delivery (n8n) | Buyer emails | Switch "Shop · Flow Starter delivery" to inactive | Not reversible; follow up by hand |
| Benjaire Flow Intake | Owner alert, sender acknowledgement | Deactivate "Flow · 1 Intake" in n8n | Not reversible; the Worker still emails `CONTACT_TO` |
| Contact Form Worker | Email to Benjaire, n8n webhook | Roll back the Worker deployment in Cloudflare | Same page, earlier deployment |

## Commerce pipeline (n8n)

All commerce workflows live in the "Commerce" folder on n8n Cloud. Per-workflow detail is in [multi-agent-commerce-pipeline.md](multi-agent-commerce-pipeline.md).

**Stop.** Open the workflow in n8n and switch it to inactive. Stopping "Shop · Flow Starter delivery" also stops buyer emails, so paying buyers wait until it is active again.

**A product went live that shouldn't have.** In Stripe, open [Payment links](https://dashboard.stripe.com/payment-links), find the product and choose **Deactivate**. The checkout stops taking money right away. Then check that the shop page no longer offers it.

**A workflow change made things worse.** Open the workflow's version history in n8n and restore the last good version.

**A buyer got a wrong or duplicate email.** Emails can't be recalled. Check the order in n8n executions and reply to the buyer by hand.

## Benjaire.com

**Benjaire Flow Intake (n8n).** Stop: in n8n Cloud, open the "Flow · 1 Intake" workflow and switch it to inactive. The contact Worker keeps emailing every inquiry to `CONTACT_TO`, so no inquiry is lost. Roll back: open the workflow's version history in n8n and restore the last good version, or import `products/flow/live-ops/workflows/1-intake.json` from `benjaire-dashboard`. Acknowledgements already sent can't be recalled.

**Contact Form Worker (Cloudflare).** Stop or roll back in Cloudflare → Workers & Pages → `benjaire-com` → Deployments: pick the last good deployment and roll back to it. To stop all sends, remove the Worker's mail secrets there; the form then answers 503.

## After any stop

Write down what happened, what was rolled back and what was sent, in the agent's section of its runbook under "When it fails", so the next stop is faster.
