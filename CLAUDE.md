# Benjaire Ops (benjaire-dashboard)

Private owner dashboard for Benjaire LLC: traffic, sales, inquiries, automation health, infrastructure and a manual finance ledger. Preact and Vite UI, Cloudflare Worker API, D1. Private repository.

It also holds the paid Flow kit source and Benjaire's live n8n exports under `products/flow/`. Keep the repository private.

## Commands (Node 22.12 or newer)

- Install: `npm ci`
- Local database: `npm run db:migrate:local`
- Run: `npm run build && npx wrangler dev` (http://localhost:8787); add `npm run dev` in a second terminal for hot reload
- Full check before any PR, must exit 0: `npm run ci` (includes the secret scan and the n8n export check)
- Flow kit zip: `npm run flow:pack -- <release date YYYY-MM-DD>`
- Accessibility: `npm run test:a11y` with `wrangler dev` running

## Non negotiable rules (from README "Rules this code follows")

- No fictional numbers. A metric has a value only from a connected source or a manual entry, and always shows its state and source.
- Private by default: every request, static files included, verifies the Cloudflare Access JWT. Missing configuration fails closed. `ALLOW_LOCAL_DEV` works only on localhost and is never set in production.
- Secrets stay server side as Worker secrets; the browser talks only to this Worker's `/api`.
- No customer personal data in D1: aggregates, manual expenses and the audit log only.
- Every write commits with its audit entry in one D1 batch.

## Needs owner approval before acting

Deploying the Worker, creating or migrating the remote D1 database, attaching a domain or changing DNS, any change to production n8n workflows (status table steps 4 and 8), and shipping a new Flow kit version (it changes what buyers download).

## Read on demand (do not preload)

| When the task involves | Read |
|---|---|
| Current build step and roadmap | `README.md` § Status |
| Cloudflare Access, D1, secrets, deploy, rollback | `docs/SETUP.md` |
| Which file does what | `README.md` § Layout |
| Visual tokens (shared Pavilion design) | `src/styles.css`, then benjaire.com `docs/design-system.md` |
| Flow kit layout, versions, how to ship | `products/flow/README.md` |
| Live n8n setup, credentials, security notes | `products/flow/live-ops/README.md`, `products/flow/live-ops/SECURITY.md` |
| Business context, project registry, decisions | The `benjaire-strategy` repo was retired on 2026-10-28; its knowledge base is in the Benjaire Website project files under `strategy/` |

Path scoped rules in `.claude/rules/` load automatically when matching files are opened.
