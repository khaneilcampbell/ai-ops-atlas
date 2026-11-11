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
| Integration Exchange (`investments`) | Finance data connections | finance-connections |
| Data Intelligence Center (`residence`) | Finance reports and KPIs | finance-kpis |
| Knowledge & Research Center (`financial-planning`) | Finance documents and research | finance-documents |
| Client Success Center (`harbor-residence`) | Client billing and renewals | client-accounts |
| Team Residence Towers (`circa`) | Team and contractor costs | team-costs |

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
