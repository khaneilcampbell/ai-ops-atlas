# Atlas as a personal command center (Phase 7.6)

Atlas is a private, single-owner AI command center. One authenticated owner (Khaneil) uses it to
oversee businesses, projects, repositories, agents, n8n workflows, infrastructure and personal
work. It is not a public SaaS product, a subscription service or a customer marketplace.

This page records the Phase 7.6 audit of earlier phases, what changed, and the resulting shape.

## Audit of earlier phases (repository as the source of truth)

| Phase / feature | What is on `main` | Verdict |
| --- | --- | --- |
| 1. Task Center & Agent Registry (#424) | Device-side task store with compare-and-set, approvals, events | KEEP |
| 2. Execution & orchestration (#430, #431) | Orchestrator, ledger, n8n Step Runner bridge with allow-list | KEEP |
| 3. Agent memory & intelligence (#432) | Scoped memory, granted tools, model routes, evaluations | KEEP |
| 4. Business intelligence (#434) | Benjaire goals, revenue, products, finance, advisor | KEEP (Benjaire is a business Atlas manages, not a tenant) |
| 5. Security & reliability (#436) | Same-site guard, redacted logs, health checks, device backup, secret scan | KEEP |
| 6. Onboarding & product configuration (#442) | Workspaces, first-run wizard, Integration Center, templates, "agent catalog (internal marketplace)", purpose "Run AI work for clients" | SIMPLIFY / REPURPOSE (below) |
| 7. Multi-tenant SaaS (#446, draft, not merged) | Organizations, memberships, roles, tenant D1, vault, metering, quotas, plans, org API | DISABLE: not merged, recommended to close (below) |
| 7.5 Stabilization (#443) | Agent gate at send time, honest integration badge, e2e test | KEEP |
| Agent Output Studio (#445) + Workflow Intelligence | Read-only outputs under the workflow canvas, verified vs simulated | KEEP |
| Tool Facilities (#444, draft, not merged) | Satellite tool buildings on the map, off by default | KEEP as is; separate decision |

### SaaS-oriented features found

- On `main`: none of public registration, organizations, invitations, subscription plans, billing
  entitlements, tenant provisioning or multi-customer admin exist. The only drift is Phase 6 product
  framing: "turns Atlas into a product a new person can set up", an "internal marketplace" with
  "installed/available" agents, a workspace purpose "Run AI work for clients", and a customer-style
  welcome ("intelligent operations platform").
- In draft PR #446 (not merged, nothing applied to production): organizations, memberships,
  owner/admin/operator/viewer roles, a separate tenant D1 database, `/api/orgs`, per-org vault,
  usage metering, quotas and plan entitlements. All of it is SaaS-only.

### Recommendation for PR #446

Close it without merging and keep its branch (`claude/project-thread-msa4z9`) for reference.
Nothing in it is needed for one owner, and nothing was applied: no D1 database bound, no secrets
set, no migration run. Two ideas are worth carrying forward later as single-owner work, not as
tenancy: a server-side copy of tasks/approvals/ledger behind the existing Access sign-in (today they
are device-only), and its AES-GCM vault pattern if Atlas ever needs to hold a credential server-side.

## What changed in Phase 7.6

All changes are additive or wording; no data is deleted or migrated destructively.

- **Command brief** (`src/product/commandCenter.ts` `commandBrief`, `src/views/CommandBrief.tsx`):
  Mission Control now opens with eight answers: agents at work, workflows running, what needs the
  owner, projects progressing, systems with problems, outputs produced, AI cost this month, business
  goals needing action. Pure function over Task Center tasks, workflow runs + ledger, approvals,
  open agent alerts and real business goals. No polling, no model calls, no new storage.
- **Portfolio** (`portfolio`, `src/views/product/Portfolio.tsx`): Workspace > Setup lists every
  building as category → business → building, with repositories, agents, workflows, open tasks and
  outputs, plus broken references. Categories: Business Operations, AI Engineering, Infrastructure,
  Personal Operations. Defaults come from the map district; the owner can move a building
  (`Workspace.categoryOverrides`), which never moves it on the map. Business comes from the
  manifest `organization`; when there is none it says "Unassigned", never a guess.
- **Private tool library**: Workspace tabs are now Setup, Tools, Agents, Workflows, Owner controls.
  Each tool card adds the projects, agents and workflows that use it (`toolUse`). Status and
  "verified" rules are unchanged (verified only after a real check).
- **Agent library**: "Agent catalog (internal marketplace)" is now "Agent library", private.
- **Personal setup**: wizard steps are Owner, Workspace, Tools, Agents, Workflows, Health check, with
  single-owner wording. Existing installs still skip it (unchanged first-run logic).
- **Purposes**: Business operations, AI engineering, Infrastructure, Personal operations, Something
  else. The old "agency" (client work) value is still accepted when loading so saved workspaces keep
  working; it is no longer offered.

## Data and compatibility

- `atlas:product` keeps version 1. `categoryOverrides` is optional; older files load with `{}`.
  Unknown categories and malformed ids are dropped on read; imports drop overrides for buildings
  that aren't in this Atlas.
- No other store changed. Tasks, runs, ledger, memory, business records, approvals, Keychain and
  Cloudflare secrets are untouched. No migration ran anywhere.
- The 3D map, districts, building ids, Tool Facilities and activity indicators are unchanged.

## Security model (unchanged, single owner)

Cloudflare Access + owner allowlist on the hosted site, Keychain + Touch ID on the Mac, same-site
guard and redacted logs on functions, approvals for sensitive task categories (only a person may
approve; an agent can't approve its own work), compare-and-set on every store, device backup. The
command brief and portfolio are read-only and add no new endpoint.

## Architecture

```
Atlas (one owner, Access / Keychain)
├─ Mission Control: Command brief → Mission Focus → alerts, inquiries, websites, health, KPIs
├─ Workspace: Setup (portfolio) · Tools · Agents · Workflows · Owner controls
├─ Category → Business → Building (catalog/*.yaml)
│    └─ Repository → Agent (registry) → Workflow (Workflow Intelligence) → Task (Task Center) → Artifact (Output Studio)
├─ Business view: Benjaire goals, revenue, products, finance (real records only)
├─ Usage + spend caps: AI and hosting cost
└─ 3D city: districts and buildings for the same catalog
```
