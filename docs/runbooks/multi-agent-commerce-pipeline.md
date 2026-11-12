# Runbooks: Commerce Operations Center

The commerce pipeline runs on n8n Cloud (khancam15.app.n8n.cloud, folder "Commerce"). Only the pipeline tests still run from the [khaneilcampbell/multi-agent-commerce-pipeline](https://github.com/khaneilcampbell/multi-agent-commerce-pipeline) repository, on GitHub Actions.

To stop or undo something a workflow sent or published, start with [stop-and-rollback.md](stop-and-rollback.md).

## Common checks

- Runs: open the workflow in n8n and check **Executions**.
- Data: n8n data tables `commerce_products` (ideas, drafts, live products) and `shop_settings` (template links).
- Errors: Design Run emails its own failures; the Shop workflows send failures to "Flow · 0 Error alerts".

## Design Run

n8n workflow [Commerce · Design product](https://khancam15.app.n8n.cloud/workflow/Pu57gD8f9Dz9gIbq). Monday and Thursday 10am, at most 2 new designs per 7 days. Ideas come from the [Add product idea](https://khancam15.app.n8n.cloud/form/commerce-idea) form.

- **Healthy:** each run saves a draft in `commerce_products` and emails Khaneil an approval link.
- **When it fails:** Khaneil gets a "Design run failed" email (attempt N of 3). A failed idea is retried up to 3 times. Check the failed step in the execution; a Canva error usually means the Canva connection needs signing in again.
- **Stop it:** switch the workflow to inactive in n8n.

## Approve and Publish

n8n workflow [Commerce · Approve product](https://khancam15.app.n8n.cloud/workflow/nbjCeZ80noaGMzXr), reached only from the approval email.

- **Healthy:** an approved product gets a Stripe product, price and payment link, and a `shop_settings` row.
- **When it fails:** retries are safe; Stripe calls use idempotency keys. "Flow · 0 Error alerts" emails the failed step.
- **Atlas:** each publish reports to Atlas as Approve and Publish.
- **Stop it:** switch the workflow to inactive. To take a live product down, see [stop-and-rollback.md](stop-and-rollback.md).

## Shop Page and Weekly Sales

n8n workflow [Commerce · Shop page and weekly sales](https://khancam15.app.n8n.cloud/workflow/ORa0g93GhM4CdKTu): the public shop page and a Monday 9am sales email. No AI calls.

- **Stop it:** switch the workflow to inactive; the shop page then stops answering.

## Order Delivery

n8n workflow [Shop · Flow Starter delivery](https://khancam15.app.n8n.cloud/workflow/pjj7ORgRjeGGTIFL). Verifies each Stripe checkout with Stripe, saves the order and emails the buyer their download or Canva template link.

- **Healthy:** every paid checkout has an execution and an order row.
- **When it fails:** "Flow · 0 Error alerts" emails the failed step. Fix it, then rerun the execution from n8n.
- **Stop it:** switching it to inactive stops buyer emails, so paying buyers wait. Prefer fixing the failed step. Roll back with the workflow's version history in n8n.
- **Atlas:** each delivery email reports to Atlas as Order Delivery; a failed send raises an alert.

## Buyer Follow Ups

n8n workflow [Shop · Flow follow ups](https://khancam15.app.n8n.cloud/workflow/1QdoYrF1XVxT4Xyu), every 4 hours: the day 2 setup check, the day 12 help reminder and one download reminder per order.

- **Approval gate:** if more emails are due in one run than `followup_max_per_run` in `shop_settings` (5 when empty), none in that batch are sent. Atlas shows a failed Order Delivery report with the count, and "Flow · 0 Error alerts" emails you. If the batch is expected, raise `followup_max_per_run`; it sends on the next run.
- **Healthy:** each send batch posts one ok report to Atlas.

## Pipeline Tests

`.github/workflows/tests.yml` in the commerce repository: compile, ruff, shell syntax, pytest.

- **Healthy:** latest run on `main` is green.
- **Stop it:** disable the workflow in Actions.

## Retired agents

The CrewAI brand crew (Niche Scout, Market Research Analyst, Brand Strategist, Visual Identity Director, Copywriter and SEO Strategist, Launch Asset Planner), the Canva Mockup Generator, SEO Maintainer, Health Dashboard Report, Daily Email Digest and Database Backup were retired on 2026-11-11 when the pipeline moved to n8n. They do not run anywhere, so there is nothing to start or stop.
