# Production reporting

Atlas now accepts production evidence independently of GitHub CI. This code must be deployed and each production host instrumented before it establishes production visibility.

## Receiver configuration

Keep the existing D1 `LIVE` binding. Set a Cloudflare secret named `PRODUCTION_AGENT_KEYS` containing a JSON object keyed by catalog agent id. Each value contains `token` (a unique random secret of at least 32 characters) and `repo` (the catalog repository, e.g. `khaneilcampbell/multi-agent-commerce-pipeline`). Never use the desktop sync token. Issue one credential per agent. Rotate by replacing that agent's token.

Example shape (replace the example token through the secret-management UI):

```json
{"commerce-loop":{"token":"REPLACE_WITH_UNIQUE_RANDOM_SECRET_AT_LEAST_32_CHARACTERS","repo":"khaneilcampbell/multi-agent-commerce-pipeline"}}
```

The existing `/api/hooks/*` Access exception also covers `/api/hooks/production`. The receiver authenticates the reporting agent, restricts its repository using server configuration, validates fields, strips unknown payload fields and deduplicates by agent/event id. No prompts, customer details or result content should be sent.

## Production host

Copy `scripts/report-production.py` to the runtime host. Set these environment variables in that agent's service configuration, keeping the token out of source control and command arguments:

- `ATLAS_PRODUCTION_URL`: `https://ai-ops-atlas.pages.dev/api/hooks/production`
- `ATLAS_AGENT_ID`: the exact catalog agent id
- `ATLAS_AGENT_TOKEN`: that agent's dedicated token

Send a heartbeat every five minutes while the service is alive:

```sh
python3 report-production.py heartbeat
```

Wrap actual task execution with run events, reusing the same run id throughout a task:

```sh
python3 report-production.py run --run-id cycle-123 --status running
python3 report-production.py run --run-id cycle-123 --status success --duration-ms 15000 --cost-usd 0.02
```

Report `failure` from the failure handler. For runs longer than 15 minutes, send another `running` report at least every five minutes. Use a distinct event id for each update; reuse `--event-id` when retrying the same delivery. The reporter exits unsuccessfully on network/HTTP failure and has a 15-second timeout; arrange retries in the service without interrupting customer work. A heartbeat must reflect process health, not an unrelated timer that remains alive when the agent dies.

## Atlas behavior and verification

L3 agents without the existing `agent_feed` integration use this production evidence rather than CI. Existing phase-feed agents retain their current integration; once a scoped production report arrives, it takes precedence. Missing or stale reporting produces unknown production status and a registry review reason. A heartbeat establishes liveness, never successful task completion. Production reports expire for liveness after 15 minutes; stale running evidence cannot keep an office showing work indefinitely. Polling re-evaluates freshness every five seconds while visible. Failures appear in the registry and office view.

Verify one heartbeat, one successful run and one failed run for each agent; then stop reporting and verify unknown status after 15 minutes. Verify a wrong agent token returns 401. A 202 means the delivery was accepted (including a deduplicated retry), not that the task succeeded.

Reporting history uses the existing feed: events are retained three days, initial connection loads up to 200 recent events from six hours, and clients retain up to 2,000 production run/heartbeat records in memory. Metrics describe the observed sample, not a complete monthly ledger. A reload may show unknown for quiet agents outside the initial window; the next heartbeat restores visibility. There is no pager or external notification integration in this change.
