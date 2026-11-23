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

The building panel shows an **Investment operations** section: connection status, last sync, what
is stored, each account's value, cash and largest positions, and data checks. The
`investment-operations` automation (paused, manual, owned by Atlas Health Monitor) is the code in
`src/finance/investments.ts`, `src/finance/investmentsLocal.ts` and `src-tauri/src/investments.rs`.

**How data gets there (Mac app only).** Robinhood's only supported route for an outside agent is
the Robinhood Trading MCP. It reads every account and can trade in the Agentic account, with no
read-only scope. So Atlas never connects to it. Instead, Khaneil asks Claude Code on the Mac to
"sync my investments". That Claude uses the Robinhood connector with all 34 write tools (orders,
cancels, option exercise, watchlist and alert changes) denied in `~/.claude/settings.json`, reads
the accounts, and writes one file: `<app data>/investments/snapshot.json`
(`~/Library/Application Support/com.khaneilcampbell.ai-ops-atlas/investments/snapshot.json`).
The Mac app reads it on open and Refresh; **Disconnect** deletes it. The website never has the
data and shows only the synthetic preview.

- `sanitizeSnapshot` keeps only `source`, `as_of` and `portfolios[]` of `label`, `kind`, `last4`,
  `agent_tradable`, `cash` and `positions[]` of `symbol`, `asset_class`, `market_value`. Account
  numbers appear only as their last four characters. It refuses the whole file when any key looks
  like an account number, credential, order, transfer or bank detail, or when more than one account
  is marked agent-tradable. Errors name fields, never values.
- `connectionState` is never greener than the data: synthetic data always reads Not connected,
  and a real snapshot turns Stale after 26 hours.
- `summarizeChange` and `dataQualityIssues` describe totals and what looks wrong. They never
  recommend buying, selling or holding. Operational summaries, not investment advice.
- Retention: one summary file on the Mac, replaced on each sync, no history. Nothing in git, CI,
  screenshots or the website; tests and screenshots use `SYNTHETIC_SNAPSHOTS`.

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
