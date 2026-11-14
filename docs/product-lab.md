# Benjaire Product Lab in Atlas

Benjaire Product Lab is Khaneil's n8n agent (`Benjaire Product Lab`, id `ruOvE7nfE713WDUL` on
https://khancam15.app.n8n.cloud). It works out the next best product for Benjaire to launch. Once a month
it runs five research roles in order, then emails Khaneil a brief and saves it to Notion. Atlas only shows it:
desks in the Benjaire Marketing Agency, entries in the Agents list, and its brief once the agent posts
one. **Atlas never runs the agent and makes no model calls for it.**

## What the agent is (read through the n8n MCP, 2026-11-04)

- One first-class n8n Agent, not a workflow, running `anthropic/claude-sonnet-5-5` with reasoning set to high,
  prompt caching, native web search (at most 5 per run) and n8n memory with observational memory.
- Five skills inside that one agent: Market Research, Competitor Analysis, Customer Insight, Product
  Scoring, Product Brief.
- Tools: `email_kc_report` (Gmail, sends only to benjaireco@gmail.com) and the Notion MCP server.
- Task "Monthly next-product report", cron `0 9 1 * *` America/New_York. First run 2026-12-01.
- n8n Agent runs are not workflow executions, so the n8n executions API doesn't show them. Atlas sees a
  run only when the agent posts its brief (below).

## Where they sit

| Catalog id | Title | Agency room |
|---|---|---|
| `benjaire-product-lab` | Product Lab Lead | Floor 1, Strategy room (`1-strategy`) |
| `benjaire-product-lab-research` | Market Research Analyst | Floor 2, Insights lab (`2-insights`) |
| `benjaire-product-lab-competitors` | Competitor Analyst | Floor 2, Brand archive & library (`2-archive`) |
| `benjaire-product-lab-customers` | Customer Insight Researcher | Floor 1, Social & community desk (`1-social`) |
| `benjaire-product-lab-scoring` | Product Scoring Analyst | Floor 2, Workshop room (`2-workshop`) |
| `benjaire-product-lab-brief` | Product Brief Writer | Floor 1, Client review room (`1-review`) |

The manifests are in `catalog/benjaire-com.yaml`, so ownership stays with Benjaire HQ and no extra
building appears on the map. Seats come from `workplace` (rooms in `src/catalog/workplaces.ts`
`AGENCY_WORKPLACE_ROOMS`, kept in step with `AGENCY_ROOMS` by a test). The figures are static and gold.
Selecting a figure or its room label opens the agent. Status stays **Configured, not verified**: the
manifests declare no `observe` source, because no telemetry exists for n8n Agent runs.

## The brief Atlas accepts

The lead agent's latest brief shows in its inspector (Agents → Product Lab Lead → Report tab), and in the
Agency's Strategy room and Client review room. It reaches Atlas as JSON posted to
`POST https://ai-ops-atlas.pages.dev/api/hooks/reports` with `Authorization: Bearer <AGENT_FEED_TOKEN>`.
That token is add-only: it can store a report but never read one back.

`src/reports/productLab.ts` checks every field, allows nothing extra and recomputes every scorecard total
(demand 25%, gap 20%, fit 15%, margin 15%, validate 15%, synergy 10%, rounded to two places). The top
pick must have the highest total, and both runners-up must be on the scorecard. Every source must be an
https link. `validated` is refused unless `evidence` lists real demand (signups, preorders, sales). The
16 KB cap applies. A brief that fails any check gets a 400 and is never shown half drawn. Example:
[`ops/product-lab/fixtures/report.json`](../ops/product-lab/fixtures/report.json).

| Field | Rule |
|---|---|
| `agent` | `"benjaire-product-lab"` |
| `at` | ISO time of the run |
| `month` | `YYYY-MM` |
| `topic`, `model` | text, 160 and 64 characters |
| `status` | `"hypothesis"` or `"validated"` |
| `evidence` | up to 6 lines; at least one when validated |
| `top`, `runners_up` (exactly 2) | `{title, pillar, offer, risk}`, pillar one of `digital`, `consumer_tech`, `digital_product`, `lifestyle` |
| `scorecard` | 3 to 10 rows `{idea, demand, gap, fit, margin, validate, synergy, total}`, scores whole numbers 1 to 5 |
| `sources` | 1 to 20 `{label, url}`, https only |
| `plan` | exactly 4 lines, week 1 to week 4 |
| `metrics` | 1 to 6 lines |
| `change_since_last_month` | text, may be empty |
| `notion_url` | https link or `null` |

Note: the example table in the agent's "Benjaire Product Scoring" skill gives the MagSafe stand 3.05.
Its scores actually add up to 3.00. Atlas would refuse that row, so the agent must compute totals with
the weights, not copy the example.

## Connecting it (Khaneil, in n8n)

Nothing in this repo changes the n8n agent. Khaneil adds one tool there:

1. Copy the site's `AGENT_FEED_TOKEN`. Cloudflare Pages → ai-ops-atlas → Settings → Variables and
   Secrets:
   https://dash.cloudflare.com/2ff911bc5c9acdcb7f6088b9a25f002f/pages/view/ai-ops-atlas/settings/production
   (If it's a secret you can't read back, use the copy you saved when it was made. The Opportunity Scout
   uses the same value as `ATLAS_FEED_TOKEN`.)
2. In n8n, create a credential: Credentials → Add credential → **Bearer Auth**, name it `Atlas reports`,
   and paste the token. https://khancam15.app.n8n.cloud/home/credentials
3. Open the agent (https://khancam15.app.n8n.cloud/home/agents → Benjaire Product Lab). Add a tool:
   **HTTP Request**, named `post_atlas_report`, method POST, URL
   `https://ai-ops-atlas.pages.dev/api/hooks/reports`, authentication Bearer Auth → `Atlas reports`, and
   body JSON from the model, described as "The finished brief as the JSON in docs/product-lab.md".
4. In the task "Monthly next-product report", add one step after the email: "Call post_atlas_report once
   with the brief as JSON in the documented shape."
5. Run the task once by hand, or wait for 1 December. Atlas shows the brief within a minute.

## Cost

Atlas: $0 and no model calls. It stores and shows JSON. The agent: one run a month on Sonnet 5.5. The
main cost is reasoning "high" plus observational memory on every run. It's worth checking in n8n whether
the monthly run needs both. Atlas never adds a schedule or a "Run now" button for this agent.
