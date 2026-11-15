# Runbook: Payment and email key scope and rotation

The keys that let unattended agents spend money or email people, what each one should be allowed
to do, and how to rotate it. Code-side audit done on 2026-11-14; the dashboard checks below can only
be done by Khaneil, because the key values and their permission lists are not visible from the code.

## What the code-side audit found (2026-11-14)

- No Stripe (`sk_`, `rk_`, `whsec_`) or Resend (`re_`) key is committed in ai-ops-atlas, benjaire.com,
  multi-agent-commerce-pipeline, khaneilcampbell.com, khaneilcampbell or splunk-bruteforce-detection-lab.
- Every key lives in a secret store: Cloudflare Worker secrets for the website, n8n credentials for
  the workflows. No workflow file or repository reads them.
- Three Stripe keys are in use, one Resend key, one Anthropic key, all listed below.
- The n8n credential "Atlas reports" is shared globally on the n8n instance. It can only post run
  reports to Atlas, so the risk is low, but it only needs to be shared with the Benjaire project.

## Keys and the scope each one needs

| Key | Where it lives | Used by | Should be |
| --- | --- | --- | --- |
| Website Stripe key (`STRIPE_SECRET_KEY`) | Cloudflare → `benjaire-com` Worker → Settings → Variables and Secrets | Contact Form Worker, `/api/checkout` | Restricted key (`rk_live_`), **Checkout Sessions: Write** only |
| n8n "Stripe account" | n8n credentials | Shop · Flow Starter delivery (reads the paid session), Shop page and weekly sales | Restricted key, **Checkout Sessions: Read** only |
| n8n "stripe commerce (write)" | n8n credentials | Commerce · Approve product | Restricted key, **Products, Prices, Payment Links: Write** only |
| n8n "Resend API" | n8n credentials | Flow intake, delivery, follow ups, design run, error alerts | Resend **Sending access** key limited to the `benjaire.com` domain |
| n8n "Anthropic (Benjaire)" | n8n credentials | Flow intake, design run, Product Lab | Its own Anthropic workspace with the $5 monthly spend limit |

## Steps only Khaneil can do

1. **Check the three Stripe keys.** Open https://dashboard.stripe.com/apikeys. Under Restricted keys,
   each of the three keys above should be listed with only the permission in the table. If any of
   them is a Standard (`sk_live_`) secret key instead, create a restricted key with that one
   permission and swap it in (step 3).
2. **Check the Resend key.** Open https://resend.com/api-keys. The key used by n8n should say
   "Sending access" and the `benjaire.com` domain. If it says "Full access", create a sending-only
   key for `benjaire.com` and swap it in.
3. **Rotate (swap) a key.** Create the new key first, then paste it into the place in the table:
   n8n credentials at https://khancam15.app.n8n.cloud/home/credentials, or the Worker secret in
   Cloudflare. Send one test (a contact form message, or a $0 Stripe test in test mode). Only then
   delete or roll the old key in Stripe or Resend.
4. **Limit "Atlas reports".** In n8n credentials, open "Atlas reports" → Sharing, and replace
   "everyone" with the Benjaire project.
5. **Write down the date.** Add the rotation date to this page so the next check knows how old
   each key is. Rotate again every 6 months, or at once if a key may have leaked.

## If a key leaks

Turn on the matching kill switch first ([stop-and-rollback.md](stop-and-rollback.md#kill-switches-stop-without-unpublishing)),
then roll the key in Stripe or Resend (Roll key revokes the old one at once), paste the new key in,
and turn the switch off.
