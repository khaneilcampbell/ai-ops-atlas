This app is now maintained inside `khaneilcampbell/ai-ops-atlas` at `apps/benjaire-dashboard`. Run app commands from this folder. Consolidation does not migrate the live Cloudflare deployment, D1 data, secrets or n8n runtime automatically. See [migration and retirement gates](https://github.com/khaneilcampbell/ai-ops-atlas/blob/main/docs/consolidation/README.md).

# Benjaire Ops

Private business dashboard for Benjaire LLC: website traffic, product sales and downloads, inquiries, n8n automation health, Cloudflare infrastructure, and a manual finance ledger. One owner, one screen.

This repository also holds the source of the paid **Flow kit** and Benjaire's live n8n workflow exports, under [`products/flow/`](products/flow/README.md).

Architecture decision: ADR-0005 in benjaire.com, currently on the unmerged [`claude/benjaire-bi-dashboard-7luk2h`](https://github.com/khancam15/benjaire.com/blob/claude/benjaire-bi-dashboard-7luk2h/docs/adr/0005-business-dashboard.md) branch.

## Rules this code follows

- **No fictional numbers.** A metric has a value only when it came from a connected source or a manual entry. Every value shows its state (Live, Delayed, Estimated, Manual, Not connected, Failing) and its source.
- **Private by default.** Cloudflare Access sits in front, and the Worker verifies the Access JWT on every request, static files included. Missing or wrong configuration fails closed.
- **Secrets stay server side.** Integration credentials are Worker secrets. The browser only talks to this Worker's `/api`.
- **No customer data stored.** D1 holds aggregates, manual expenses and the audit log. Names, emails and messages stay in n8n.
- **Every change is audited.** Writes and their audit entries commit in one D1 batch.

## Status

| Step | Scope | State |
|---|---|---|
| 1 | Shell, Access check, D1 schema, Connections, manual finance, audit log | Done |
| 2 | Cloudflare analytics, builds, security, synthetic checks | Next |
| 3 | GitHub activity | Planned |
| 4 | n8n Ops feed (aggregates only, signed) | Needs owner approval (production n8n change) |
| 5 | Stripe revenue, refunds, fees | Planned |
| 6 | Profitability and cash flow | Planned |
| 7 | Alerts, contract tests, security review | Planned |
| 8 | `dashboard.benjaire.com` | Needs owner approval (DNS) |

## Run locally

Requires Node 22.12 or newer.

```bash
npm ci
npx wrangler d1 migrations apply benjaire-dashboard --local
printf 'ALLOW_LOCAL_DEV=true\nDEV_EMAIL=you@localhost\n' > .dev.vars   # git-ignored
npm run build && npx wrangler dev        # http://localhost:8787
```

`ALLOW_LOCAL_DEV` skips Access only when the request host is `localhost` or `127.0.0.1`. It is never set in production. For UI work with hot reload, run `npx wrangler dev` in one terminal and `npm run dev` in another (Vite proxies `/api`).

## Checks

```bash
npm run ci          # Worker types, unit tests, UI types and build, secret scan, Flow export check
npm run test:a11y   # axe WCAG 2.2 AA + no sideways scroll, light/dark, desktop/phone (needs wrangler dev running)
```

GitHub Actions runs both on every pull request. Dependabot opens grouped dependency updates every Monday.

## Layout

| Path | What |
|---|---|
| `worker/index.ts` | Request flow: authenticate, then API routes or static assets |
| `worker/access.ts` | Cloudflare Access JWT verification (RS256, issuer, audience, expiry, email allow list) |
| `worker/finance.ts` | Expense validation and month calculations, with the rules shown in the UI |
| `worker/sources.ts` | Integration catalog, least-privilege permissions, freshness rules |
| `worker/overview.ts` | Executive overview tiles |
| `worker/db.ts` | D1 queries; every write paired with its audit entry |
| `migrations/` | D1 schema |
| `src/` | Preact UI (pages, components, Pavilion design tokens in `styles.css`) |
| `scripts/` | Accessibility check, secret scan, n8n export check |
| `docs/SETUP.md` | Cloudflare setup and deployment, step by step |
| `products/flow/` | Flow kit source, its build and pack scripts, and the live n8n exports ([README](products/flow/README.md)) |
| `.github/` | CI workflow and Dependabot |
| `CLAUDE.md`, `.claude/rules/` | Instructions for Claude sessions working in this repo |
