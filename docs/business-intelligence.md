# Business (Production Phase 4)

The **Business** view (left nav, and "Open Business" in the Business Operations HQ building panel)
tracks Benjaire's goals, leads, customers, products, revenue and costs. Code: `src/business/`
(logic, no React) and `src/views/business/` (screens).

## Rules it keeps

- **No invented data.** Every record is `real` (entered or imported, with a checkable `source`) or
  `test` (labelled, shown only in Test data mode, never counted in real figures). Test data can be
  added and removed in one click.
- **Device only.** Records live in local storage `atlas:business`, behind the Task Center's
  `Backend` interface, compare-and-set on `rev`. Nothing goes to the site, an agent or a model.
  Personal details stay out of the repository (it is public).
- **Money** is whole minor units (cents) per record with an explicit ISO currency. Never converted;
  totals are per currency. `parseMoney` refuses more than two decimals.
- **Revenue is cash received** on recorded orders (gross − refunds − fees), not recognised
  accounting revenue. Operating profit is always labelled an estimate. Definitions:
  `METRIC_DEFINITIONS` in `src/business/finance.ts`, shown on the Revenue & costs tab.
- **People approve, automations propose** (`src/business/access.ts`). Agents, n8n and Atlas can only
  add test data or suggest. Recording real money, moving a product into Build / Launch / Measure,
  approving or publishing a listing, and confirming a goal need a person.

## Pieces

| Area | File | Notes |
| --- | --- | --- |
| Goals | `goals.ts` | Metric from real records; separate *work done* (linked workflow runs) and *business result*. Confirmed only by a person, once met, with evidence. |
| Pipeline | `revenue.ts` | New → Qualified → Contacted → Proposal → Won / Lost (`LEAD_TRANSITIONS`). Contact needs consent; do-not-contact blocks follow-ups. Conversion counts every stage a lead reached. |
| Sales | `revenue.ts`, `intake.ts` | Manual entry refuses duplicates by order ref. `reconcilePurchase` records a provider event only with the provider's own confirmation matching order, currency and gross; a webhook alone is never proof. |
| Products | `products.ts` | Research → … → Measure. Product Lab briefs become opportunities (`productFromBrief`). Marketplace listing: versions with price, approve, then a person records the live page. Atlas never publishes. |
| Finance | `finance.ts` | Gross, refunds, fees, net, opex, AI API, infrastructure, product costs, contribution margin, estimated profit. Task-reported AI cost shown beside, never added. |
| Dashboard | `dashboard.ts` | Filters: dates, product, business area, sales source. Missing metrics say why. CAC only with marketing spend and new paying customers. |
| Agent impact | `impact.ts` | Direct / assisted outcomes only with evidence; no estimated share. |
| Advisor | `advisor.ts` | Fixed rules, minimum samples, evidence + dates + assumptions + certainty + approval. "Run business review" turns findings into Task Center tasks (deduped by intake key). No model call. |
| Retention | `access.ts` | Lost leads removed after 180 days; do-not-contact details cleared. |

Workflow Intelligence shows a **Business outcome** block on live steps (goals the run counts toward,
their metric, execution cost), and a goal links to its runs.

## Not connected yet (needs Khaneil)

- **Payments**: no read-only Stripe (or other) connection, so sales are typed in and marked
  "Entered". `reconcilePurchase` is ready for a server-verified feed.
- **n8n revenue workflows**: the inquiry, sales and review flows run in Atlas on demand. Extending
  the live n8n workflows needs edits in n8n (Atlas's n8n key is read-only).
- **Sync**: records stay on one device until a server store (D1) replaces the local backend.
- **Model second opinion**: the advisor copies a redacted evidence brief; Phase 3 routing isn't on
  main yet.
