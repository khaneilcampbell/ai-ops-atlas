# Production Coordinator: external n8n advisor

Inspected through the connected n8n account on 2026-11-05. The existing Atlas ID `atlas-production-coordinator` maps to **Atlas Release Coordinator**, agent `xwPwuboturejm9hz`, in n8n. Its two skills cover production triage/release planning and supplied-draft release handoffs. Atlas's Documentation tab links directly to the agent. No duplicate registration or workplace was added; it stays on Atlas HQ Floor 3.

## Verified configuration versus execution

The agent is published. Its draft passes n8n configuration/credential validation, has no ordinary tools, no custom reporting tool and no scheduled tasks. It can advise from supplied evidence and has native web search and observational memory enabled. Configuration validation is not a successful model run. No paid chat or tool execution was started in this review.

The current published snapshot is `8d11cc79-0155-468e-8009-6ac8fea4f820`; the inspected draft is `96c2a71a-3663-43ad-8e06-2808d6bdfb89`. The draft configures a $1 monthly budget and $0.25 session cap. The published snapshot does not contain those guardrails. Do not describe the live agent as capped based on draft settings. No runtime budget enforcement test was performed.

The existing `benjaire-production.yml` source remains unchanged: its runs are the separate supplied-draft fixture, not evidence that the n8n agent executed. Atlas does not yet receive its n8n output.

## Three recommended improvements

1. **Publish reviewed spending limits before use.** Review the draft's budget controls, validate the intended version, and separately authorize publication. Keep requests manual. Retain fail-closed limits; do not interpret a configured cap as runtime-tested accounting.
2. **Reduce unnecessary context and search.** For supplied CI evidence, routine web search adds little value. Consider disabling search by default and observational memory for one-off reviews, while retaining prompt caching. Only enable external research for a specific missing fact. This is a recommendation; no settings were changed.
3. **Add scoped reporting with preserved sources.** Emit actual execution IDs/status through a dedicated reporting identity, separately from a schema-validated recommendation report. Keep n8n advice, GitHub fixture results, approvals, web deployment and desktop installation distinct. The current telemetry selector prioritizes production reports over GitHub history; review that presentation before connecting a second source so existing evidence is not hidden.

## Reporting connection still required

No credential matching Atlas was returned by n8n's credential search. Credentials cannot be created through the available connector. An authorized operator must provision a reporting-only credential in n8n and its matching server-side identity; never paste the value into chat or a workflow export.

Existing compact destination: `POST https://ai-ops-atlas.pages.dev/api/hooks/production`, Bearer auth. Server configuration `PRODUCTION_AGENT_KEYS` binds `atlas-production-coordinator` to `khaneilcampbell/ai-ops-atlas`. Confirm actual deployed setup before use. Never substitute the desktop sync key or an administrator credential.

Only compact run metadata belongs there: agentId, eventId, kind, runId, status, optional durationMs/costUsd. Unknown cost is omitted. The same event ID is reused for retry; a later lifecycle update has a different event ID. A receiver 202 means accepted delivery, not successful business work. The current endpoint does not store full advice or artifacts; that needs a separate reviewed report schema. No credential attachment, token creation, publication, deployment or live reporting was performed.
