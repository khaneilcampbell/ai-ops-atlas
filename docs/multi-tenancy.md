# Multi-tenancy (Production Phase 7, foundation)

Atlas is still a single-owner product. This change adds the server-side foundation for separate
customer organizations, switched **off** on the live site. Nothing changes for Khaneil until the
steps under "Switching it on" are done by hand. Atlas is **not** ready for public SaaS customers;
see "What is still missing".

## What was real before this change

| Area | What exists | Where data lives |
|---|---|---|
| Sign-in | Cloudflare Access in front of the site, token re-verified in `server/access.ts`; optional `ALLOWED_EMAILS` (not set yet) | Cloudflare |
| Task Center, workflow runs, execution ledger | Real, with compare-and-set writes | **The device only** (`localStorage`) |
| Agent memory, decisions, evaluations | Real | **The device only** |
| Business records (customers, sales, goals) | Real | **The device only** |
| Workspace (Phase 6) | One workspace, `benjaire` | **The device only** |
| Approvals | Real, enforced in the app | **The device only**, no server check |
| n8n bridge, live events, inquiries, reports | Real, owner-only | D1 `atlas-live` (`LIVE`) |
| Agents, buildings, map | Catalog YAML compiled into the app bundle | The repository (public) |
| Roles, organizations, memberships | Did not exist | – |

So there was no server-side record of tasks or runs to isolate. The tenancy layer therefore adds a
**new, separate D1 database** (`TENANT`) and an API in front of it, rather than retrofitting the
owner's device storage or the live `LIVE` database.

## What this adds

- **Organizations, memberships, workspaces, projects, settings** (`migrations/tenant/0001_tenancy.sql`).
- **One permission matrix** (`src/tenancy/permissions.ts`): owner, admin, operator, viewer. No role
  names are compared anywhere else. Role changes refuse escalation (nobody grants above their own
  role, only owners touch owners), self-changes, and losing the last active owner. The last-owner
  rule is also enforced inside the SQL write, so concurrent requests can't race past it.
- **One authorization gate** (`server/tenancy/core.ts` `authorize`): the Access token is verified
  again, then the membership and role are read from the database on every request (no cached
  permissions, so removal takes effect on the next request). Unknown organizations and
  non-membership both answer 404, so existence never leaks. Every refusal is written to the audit log.
- **Tenant-scoped records** (`server/tenancy/repo.ts`): agents, workflows, tasks, runs, memory,
  artifacts, business and customer records in one `resources` table keyed `(org_id, kind, id)`. The
  organization id is always bound from the authorized membership, never from the request. References
  (task to agent, building, workflow, dependency; memory to building) are checked in code and by
  composite foreign keys in the database, so a cross-organization link can't be stored even by a
  bug. A body naming another organization is refused. Records that look like credentials are refused.
- **Shared agent templates**: read by everyone, written only by `PLATFORM_ADMINS`. Organizations
  install a template by creating their own agent that names it.
- **Tenant dispatch gate** (`server/tenancy/dispatch.ts`): checks workspace, workflow, task, agent and
  dependencies all belong to the same organization and workspace, the agent is on, the task's agent
  and workflow match, approvals are granted; then takes quota and issues a trusted envelope with
  organization, workspace, workflow, run, task, agent and correlation ids. Each dispatch gets its own
  callback key (only its hash is stored). Callbacks look the organization up from the stored
  dispatch, refuse any mismatched id in the body, finish once, and deduplicate usage. Retries reuse
  the stored context and check everything again. Agents read context only from their own
  organization and workspace while the dispatch runs.
- **Integration vault** (`server/tenancy/vault.ts`): AES-GCM with the site secret `TENANT_VAULT_KEY`;
  the organization and integration ids are bound into the cipher, so a ciphertext moved to another
  organization doesn't decrypt. Allowed scopes per provider, redacted views only, rotation,
  revocation (erases the ciphertext), and real read-only connection checks for GitHub and Cloudflare
  (others say "not checked", never "connected").
- **Usage metering** (`server/tenancy/metering.ts`): append-only events (database triggers refuse
  updates and deletes) with a per-organization deduplication key, `metered` vs `estimated`, and
  period totals. Atlas records only figures it counted itself (dispatches, durations) or a worker
  reported; it never invents provider usage.
- **Quotas**: concurrent executions (expiring leases), daily tasks, monthly model tokens, all checked
  with one conditional SQL statement each so concurrent requests can't overshoot. Soft-limit warning
  at 80% (audited once), hard refusal with 429, owner-only overrides (audited). Nothing ever spends
  money when a limit is hit.
- **Plans** (`src/tenancy/plans.ts`): Personal, Professional, Business, Enterprise as entitlement data
  only. No prices, `commerciallyAvailable: false`, no billing provider. `BillingProvider` is the
  contract a future integration would fill; enforcement never depends on it.
- **Audit log**: membership changes, admin actions, refused access, quota events, integration
  changes, tenant mismatches. Details are redacted; no secrets or record contents.
- **Legacy import** (`src/tenancy/legacyImport.ts`, `scripts/tenancy-import.mjs`): turns a device
  backup into idempotent SQL that creates the protected Benjaire owner organization and copies every
  task, run (with its execution ledger), memory record, decision, customer and business record with
  its existing id, keeping agent, building and workflow links (with marked placeholders for catalog
  agents and buildings). It writes files only.

## API (all behind Cloudflare Access)

`/api/orgs` (list, create) · `/api/orgs/:org` (read, rename) · `/delete` · `/members[/:email]` ·
`/workspaces` · `/resources/:kind[/:id]` · `/approvals/:task` · `/dispatch[/:id/retry]` ·
`/integrations[/:id/rotate|revoke|check]` · `/usage?period=YYYY-MM` · `/quotas` · `/entitlements` ·
`/audit` · `/api/orgs/templates[/:id]`. Workers use `/api/hooks/tenant-callback` and
`/api/hooks/tenant-context` with `TENANT_CALLBACK_TOKEN` plus the per-dispatch key.

Every route answers **503** until the site has a `TENANT` binding **and** `TENANCY_ENABLED=1`.

## Switching it on (Khaneil, by hand, staging first)

Nothing below has been run. Do it on a preview deployment before production.

1. Create a new database: `npx wrangler d1 create atlas-tenant` (a new database; `atlas-live` is untouched).
2. Apply the schema: `npx wrangler d1 execute atlas-tenant --remote --file=migrations/tenant/0001_tenancy.sql`.
3. Back up first on every later change: `npx wrangler d1 export atlas-tenant --remote --output=atlas-tenant-backup.sql`.
4. Export a device backup from the Mac app (Settings > Data > Back up), then on your Mac:
   `OWNER_EMAIL=<your Access email> node scripts/tenancy-import.mjs <backup.json>`. Read
   `tenancy-import/summary.json`, then apply `tenancy-import/import.sql` the same way as step 2 and
   run `tenancy-import/verify.sql`: counts must match `expected`, `dangling` and `orphans` must be 0,
   and `PRAGMA foreign_key_check` must return nothing. The folder is git-ignored (private data).
5. Pages settings: bind D1 `atlas-tenant` as `TENANT`; add secrets `TENANT_VAULT_KEY`
   (`openssl rand -base64 32`), `TENANT_CALLBACK_TOKEN` (`openssl rand -hex 32`),
   `PLATFORM_ADMINS` (your email); set `TENANCY_ENABLED=1` on the preview environment only.
6. Set `ALLOWED_EMAILS` (still outstanding from Phase 5) before anyone else is added to Access.

## Rollback

- Fastest: remove `TENANCY_ENABLED` (or the `TENANT` binding). Every tenancy route returns 503; the
  owner experience never depended on it.
- Imported data only: run `tenancy-import/rollback.sql` (removes that organization's rows; audit
  events stay because they are append-only).
- Whole schema: `migrations/tenant/0001_tenancy.down.sql`, after an export.
- Code: revert the pull request.

Device storage is never modified by any of this, so the Mac app keeps working throughout.

## What is still missing before any customer can use it

- **The app still reads device storage.** Task Center, workflow runs, memory and business records
  in the UI are still the owner's device copies. Moving them onto `/api/orgs` (a server
  `TaskRepository` and friends) is the next step; until then the API is the enforced boundary but
  the screens don't use it.
- **The catalog is in the public bundle.** Agents, buildings and links are compiled into the app
  (and the repository is public), so every signed-in user would see Benjaire's catalog. The 3D map
  must load private building data from `/api/orgs/:org/resources/project` before customers are let
  in. The scene renderer itself needs no change.
- **No organization admin screens yet** (members, usage, integrations, security pages). The API is
  ready for them.
- **Tenant dispatch is not wired to n8n.** The gate issues envelopes and handles callbacks; the
  existing n8n step runner is still owner-only and unchanged.
- **The Mac app is single-owner** (sync key, Keychain). It does not use organizations.
- **Identity is the Access email.** Changing a person's email changes their identity; there is no
  invitation flow beyond adding their email (Access must also admit them).
- **Not done: abnormal-usage detection, retention pruning, per-workspace permissions, storage
  metering, provider checks for n8n/Anthropic/OpenAI.**
- No deployment, penetration test or load test has been done.
