# Benjaire finance in the Financial District

Every Financial District building belongs to **Benjaire**. Each one is a Benjaire finance or
operations building, and each has a defined place for part of Benjaire's business data. Later,
an import or an agent can fill that place without anyone having to decide where the data goes.

Nothing is connected yet. Atlas holds no bank logins, card numbers, tokens or figures for Benjaire.

## The three files

| File | What it holds |
| --- | --- |
| `catalog/workspace/buildings.yaml` | Display name, `organization: Benjaire`, and the old fictional brand in `former_names`, which search still finds |
| `catalog/workspace/finance.yaml` | The shape of the data: per building, a `focus` line and its `datasets` (id, label, holds, fields, sources, optional `feed`) |
| `src/finance/benjaire.ts` | Reads finance.yaml (schema `atlas/finance-v1`) and works out each data set's status |

The panel section is `src/components/BenjaireFinance.tsx`. It shows under the building's
description when the building is selected, and the district panel lists every building with
its focus.

## Buildings and data sets

| Building (id) | Focus | Data sets |
| --- | --- | --- |
| Financial Operations Tower (`banks`) | Cash, bank accounts and money in and out | bank-accounts, cash-flow, ai-spend (feed), spend-caps (feed) |
| Business Finance Center (`business-finance`) | Profit and loss, revenue, invoices and costs | profit-and-loss, revenue, invoices, expenses, subscriptions |
| Budget & Forecasting Center (`budget`) | Budgets, forecasts and runway | budget-vs-actual, cash-forecast |
| Governance & Compliance Center (`records`) | Tax, filings and compliance deadlines | tax-records, business-filings |
| Risk & Insurance Center (`insurance`) | Insurance and financial risk | insurance-policies, financial-risks |
| Investment Operations Center (`investments`) | Investments, agent trading and finance data connections | brokerage-holdings, agent-trades, trading-limits, finance-connections |
| Data Intelligence Center (`residence`) | Finance reports and KPIs | finance-kpis |
| Knowledge & Research Center (`financial-planning`) | Finance documents and research | finance-documents |
| Client Success Center (`harbor-residence`) | Client billing and renewals | client-accounts |
| Team Residence Towers (`circa`) | Team and contractor costs | team-costs |

## Facade signs

Each tower's sign reads the workspace name (`workspace.name` in `catalog/workspace/workspace.yaml`,
Benjaire) over the building's `sign` line from finance.yaml, in the building's own colours. Another
business would see its own name with no code change. A building without `sign` keeps its own sign
art (Team Residence Towers has none). The code is `financeSignLines` in `src/finance/benjaire.ts`,
drawn by `src/views/map3d/FinancialSigns.tsx`.

## Investment Operations Center

This building is where the agentic trading account will land. It is planned, not connected.
The data sets are holdings (read only), a log of every agent trade with who approved it, and the
trading limits agents must stay inside. Atlas places no orders. Connecting the account follows the
Oct 31 safety plan (read only first, then paper trading, then live with approval).

### Read-only connector boundary (Nov 23)

The building panel shows an **Investment operations** section: connection status, last sync,
what Atlas stores (nothing), a disabled "Connect a read-only source" button, and a **synthetic
preview** labelled as invented data. The `investment-operations` automation (paused, owned by
Atlas Health Monitor) is the code in `src/finance/investments.ts`:

- `sanitizeSnapshot` keeps only `source`, `as_of`, `cash` and `positions[]` of `symbol`,
  `asset_class`, `market_value`. No quantity, cost basis, lots, account or order fields. It refuses
  the whole payload when any key looks like an account number, credential, order, transfer or bank
  detail, and its errors name fields, never values, so a refusal can be logged safely.
- `connectionState` is never greener than the data: synthetic data always reads Not connected,
  and a real snapshot turns Stale after 26 hours.
- `summarizeChange` and `dataQualityIssues` describe what changed and what looks wrong. They never
  recommend buying, selling or holding. Operational summaries, not investment advice.
- Retention: nothing is stored. The preview lives in memory and is gone on reload.

**Why nothing is connected.** As of Nov 23 2026 Robinhood's only supported route for an outside
agent is the Robinhood Trading MCP (`agent.robinhood.com/mcp/trading`). Its support page says a
connected agent gets read access to every Robinhood account, including account numbers, and can
trade in the Agentic account. No read-only scope is documented, n8n is not a listed platform (other
platforms must contact Robinhood support), and there is no public brokerage-data REST API (the
public API is crypto trading). Atlas does not use unofficial endpoints, scraping or shared logins.

**Next bounded step**, once a supported read-only source exists (or Robinhood confirms a
read-only connection for n8n): an n8n workflow (manual or daily trigger, map to the allowlist,
drop everything else, POST to an authenticated Atlas hook using the existing sync-key pattern,
store only a status row: last sync, position count, ok or error), a Pause/Disconnect control, and a
desk in the building once the assistant is an AI agent with an identity. The hook must run
`sanitizeSnapshot` again on the server and never log the body.

## Status: never greener than the data

| Status | When |
| --- | --- |
| **Live** | The data set names a `feed` Atlas already has, and that feed has data right now. Only `ai-spend` (API Usage records) and `spend-caps` (Spend against caps) exist. |
| **Imported** | The local finance store holds records for this data set id (see below). |
| **Not connected** | Anything else. The panel says "No data yet" and where the data can come from. |

finance.yaml cannot set a status, a date or a figure. The parser rejects `status`, `as_of` and
`value` keys, so a data set can't be marked live by editing the file.

## Where data is written

The repository is public, so **Benjaire's records never go into git**. An import or agent writes
records under the data set's `id`, using the `fields` listed in finance.yaml:

- **Mac app:** a local file per data set in the app's data folder, `finance/<dataset-id>.json`,
  shaped as `{ "dataset": "<id>", "source": "<one of sources>", "as_of": "<ISO date>", "records": [ { <fields> } ] }`.
- **Web (behind Cloudflare Access):** the same records in a private D1 table, one row per record,
  keyed by data set id. This is planned, not built.

Neither store exists yet. When one does, it supplies the `ImportSnapshot` that `datasetState`
already takes (data set id to `{ asOf, source }`), and the data set shows as Imported. Agents
only read and write through the store. They never hold bank or card credentials.

## Add or change a data set

1. Add it under the building in `catalog/workspace/finance.yaml` with a unique `id`, a `label`,
   what one record `holds`, its `fields` and its `sources`.
2. Only add `feed` when an Atlas feed already serves the data (add a new feed to `FINANCE_FEEDS`
   in code first).
3. Run `npx vitest run src/finance`. The test checks every Financial District building has a
   place, belongs to Benjaire, and that the file has no statuses or figures.
