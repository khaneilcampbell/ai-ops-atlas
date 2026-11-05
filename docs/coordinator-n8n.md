# Production Coordinator: external n8n advisor

Inspected through the connected n8n account on 2026-11-05. The existing Atlas ID `atlas-production-coordinator` maps to **Atlas Release Coordinator**, agent `xwPwuboturejm9hz`, in n8n. Its two skills cover production triage/release planning and supplied-draft release handoffs. Atlas's Documentation tab links directly to the agent. No duplicate registration or workplace was added; it stays on Atlas HQ Floor 3.

## Verified configuration versus execution

The agent is published. Its draft passes n8n configuration/credential validation, has no ordinary tools, no custom reporting tool and no scheduled tasks. It can advise from supplied evidence. The reviewed draft now has native web search and memory disabled, with prompt caching retained; the active published snapshot still uses its prior settings. Configuration validation is not a successful model run. No paid chat or tool execution was started in this review.

The current published snapshot is `8d11cc79-0155-468e-8009-6ac8fea4f820`; the inspected draft is `96c2a71a-3663-43ad-8e06-2808d6bdfb89`. The draft configures a $1 monthly budget and $0.25 session cap. The published snapshot does not contain those guardrails. Do not describe the live agent as capped based on draft settings. No runtime budget enforcement test was performed.

The existing `benjaire-production.yml` source remains unchanged: its runs are the separate supplied-draft fixture, not evidence that the n8n agent executed. Atlas does not yet receive its n8n output.

## Draft improvements completed

On 2026-11-05 the connected n8n draft was updated with optimistic config-hash protection: web search disabled, its native search tool removed, memory and observational memory disabled, existing prompt caching and $1/month plus $0.25/session limits retained. Instructions now limit each request to three evidence-backed priorities and explicitly forbid claiming Atlas delivery without a verified integration. No tools, tasks, credentials or schedules were added.

The updated draft passed n8n configuration validation with no missing fields. Read-back config hash: `635c6aa6b5aecf669ed0a1dd5524eed8392e8ffe12c9524c4fd69dc4b1efd803`. No paid model test or runtime budget test was run. The active published snapshot remains unchanged; publishing requires explicit user confirmation under the n8n publishing tool's instructions. Completing draft preparation is not activation.

Rollback before publication: restore the prior draft's search and memory settings and original instructions; retain budget limits. Never restore an uncapped published version merely to undo a cosmetic instruction change.

## Remaining recommendations

1. **Publish reviewed spending limits before use.** Review the draft's budget controls, validate the intended version, and separately authorize publication. Keep requests manual. Retain fail-closed limits; do not interpret a configured cap as runtime-tested accounting.
2. **Reduce unnecessary context and search.** For supplied CI evidence, routine web search adds little value. The draft now disables search and memory for one-off supplied-evidence reviews while retaining prompt caching. Only consider re-enabling external research for a specific missing fact after review. These draft settings do not change the existing published version.
3. **Add scoped reporting with preserved sources.** Emit actual execution IDs/status through a dedicated reporting identity, separately from a schema-validated recommendation report. Keep n8n advice, GitHub fixture results, approvals, web deployment and desktop installation distinct. The current telemetry selector prioritizes production reports over GitHub history; review that presentation before connecting a second source so existing evidence is not hidden.

## Reporting connection still required

No credential matching Atlas was returned by n8n's credential search. Credentials cannot be created through the available connector. An authorized operator must provision a reporting-only credential in n8n and its matching server-side identity; never paste the value into chat or a workflow export.

Existing compact destination: `POST https://ai-ops-atlas.pages.dev/api/hooks/production`, Bearer auth. Server configuration `PRODUCTION_AGENT_KEYS` binds `atlas-production-coordinator` to `khaneilcampbell/ai-ops-atlas`. Confirm actual deployed setup before use. Never substitute the desktop sync key or an administrator credential.

Only compact run metadata belongs there: agentId, eventId, kind, runId, status, optional durationMs/costUsd. Unknown cost is omitted. The same event ID is reused for retry; a later lifecycle update has a different event ID. A receiver 202 means accepted delivery, not successful business work. The current endpoint does not store full advice or artifacts; that needs a separate reviewed report schema. No credential attachment, token creation, publication, deployment or live reporting was performed. The safe draft configuration improvements described above are the only n8n mutation.
