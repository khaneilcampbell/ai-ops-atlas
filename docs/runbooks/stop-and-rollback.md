# Runbook: Stop and roll back the sending and publishing agents

One page for the agents that email people or change what the public sees. Use it when one of them misbehaves: stop it first, then roll back. Per-agent detail lives in [multi-agent-commerce-pipeline.md](multi-agent-commerce-pipeline.md) and [benjaire-com.md](benjaire-com.md).

| Agent | Sends or publishes | Fastest stop | Roll back |
| --- | --- | --- | --- |
| Commerce Autonomous Loop | Drives every phase below | `./run.sh pause` | Per phase, below |
| Stripe Publisher (Phase 5) | Stripe products, storefront pages | `./run.sh pause` | Deactivate the payment link, set the listing back to draft |
| SEO Maintainer (Phase 6) | Storefront titles, meta and tags | `./run.sh pause` | Restore tags from `seo_review`, redeploy |
| Storefront deploy | `gh-pages` site | `./run.sh pause` | Push an earlier site commit |
| Order Delivery | Buyer emails | `MAX_EMAILS_PER_DAY=0` in `.env` | Not reversible; follow up by hand |
| Daily Email Digest | Email to KC | `./run.sh pause` | Nothing to undo |
| Benjaire Flow Intake | Owner alert, sender acknowledgement | Deactivate "Flow · 1 Intake" in n8n | Not reversible; the Worker still emails `CONTACT_TO` |
| Contact Form Worker | Email to Benjaire, n8n webhook | Roll back the Worker deployment in Cloudflare | Same page, earlier deployment |

## Commerce pipeline (on the VPS)

All commands run from the repository folder (`/root/multi-agent-commerce-pipeline` in the documented setup).

### 1. Stop

1. **Pause, don't kill.** `./run.sh pause` creates the `PAUSE` file. From the next phase on, every phase is skipped except Order Delivery, so paid buyers still get their templates. Atlas shows the loop as paused when the agent feed is set up.
2. **Stop everything** only when delivery itself is the problem: `systemctl stop commerce-pipeline`. Paying buyers then wait until it restarts.
3. **Stop buyer emails without stopping the loop:** set `MAX_EMAILS_PER_DAY=0` in `.env`. Sends past the cap are recorded as failed and retried once the cap is raised, so nothing is lost.
4. Confirm: `tail -n 20 logs/loop.log` shows `Skipped ... loop is paused`.

### 2. Roll back

**A product went live that shouldn't have.**

1. In Stripe, open [Payment links](https://dashboard.stripe.com/payment-links), find the product and choose **Deactivate**. The checkout stops taking money right away.
2. Set the listing back to draft so the next build drops it:
   `sqlite3 outputs/pipeline.db "UPDATE listings SET status = 'draft' WHERE product_name = '<product>';"`
3. Rebuild and push the storefront: `./run.sh store-deploy`.

**An SEO change made a page worse.**

1. See what changed: `sqlite3 outputs/pipeline.db "SELECT reviewed_at, original_tags, optimised_tags FROM seo_review WHERE product_name = '<product>' ORDER BY reviewed_at DESC LIMIT 3;"`
2. Restore the earlier tags and drop the SEO title and description (the build then falls back to the listing's own title and description):
   `sqlite3 outputs/pipeline.db "UPDATE listings SET tags = (SELECT original_tags FROM seo_review WHERE product_name = '<product>' ORDER BY reviewed_at DESC LIMIT 1), seo_title = NULL, seo_description = NULL WHERE product_name = '<product>';"`
   Then `./run.sh store-deploy`.
3. To keep it from being reapplied, leave the loop paused, or run Phase 6 with `--analyze-only` while you review.

**The whole storefront is broken.**

1. `cd site && git log --oneline | head` lists earlier builds (the site folder keeps its own history).
2. Push a good build: `git push --force "$STOREFRONT_GIT_REMOTE" <good-commit>:gh-pages` (use `STOREFRONT_GIT_BRANCH` if it isn't `gh-pages`).
3. Keep the loop paused until the cause is fixed, or the next deploy overwrites the rollback.

**A buyer got a wrong or duplicate email.** Emails can't be recalled. A checkout line is never emailed twice by design, so check `deliveries` in `outputs/pipeline.db` and reply to the buyer by hand.

### 3. Resume

1. Fix the cause and check credentials: `./run.sh preflight` (exit 0).
2. Restore any cap you lowered in `.env`.
3. `./run.sh resume` (or `systemctl start commerce-pipeline` if you stopped it). Watch one cycle in `logs/loop.log`.

## Benjaire.com

**Benjaire Flow Intake (n8n).** Stop: in n8n Cloud, open the "Flow · 1 Intake" workflow and switch it to inactive. The contact Worker keeps emailing every inquiry to `CONTACT_TO`, so no inquiry is lost. Roll back: open the workflow's version history in n8n and restore the last good version, or import `products/flow/live-ops/workflows/1-intake.json` from `benjaire-dashboard`. Acknowledgements already sent can't be recalled.

**Contact Form Worker (Cloudflare).** Stop or roll back in Cloudflare → Workers & Pages → `benjaire-com` → Deployments: pick the last good deployment and roll back to it. To stop all sends, remove the Worker's mail secrets there; the form then answers 503.

## After any stop

Write down what happened, what was rolled back and what was sent, in the agent's section of its runbook under "When it fails", so the next stop is faster.
