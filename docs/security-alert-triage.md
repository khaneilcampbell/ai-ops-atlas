# B4 Security Alert Triage

Owner: existing Application Security Analyst (`service-desk-codeql`, Service Desk). Scope: Atlas (which contains Service Desk) and SOC Lab's `splunk-bruteforce-detection-lab`. Reuses `ops/github-steward/collect.py`; no duplicate collector, new registered agent, model call, or inbound webhook is introduced.

## Prepared capability

A manual **Service Desk CodeQL** dispatch runs the B4 report job; existing push/PR/weekly CodeQL scans retain their behavior. Atlas's current agent Output tab links the real workflow run, result, job summary, and artifact. There is no fake `last_run`. The workflow must be merged before GitHub permits its first manual dispatch, which is a separate activation decision.

The collector reads metadata, ten recent runs, and first pages of twenty open Dependabot/code-scanning alerts for each allowlisted repository: eight GET requests maximum, eight seconds per request, seventy-second collector budget, no retries, and a two-minute serialized workflow deadline. Triage exports only allowlisted repository names, alert numbers, severity and constructed GitHub evidence URLs—not advisory bodies, source snippets, account data, tokens, or raw responses. Original collection evidence is kept in process and not written to the report.

Local manual invocation using existing GitHub CLI authentication:

```sh
python3 ops/security/alert_triage.py --output /tmp/atlas-security-triage --state /tmp/atlas-security-triage-state.json
```

Run one local review at a time. Hosted runs are serialized. Complete evidence is fingerprinted to identify unchanged inputs; incomplete evidence never advances that state. Cache eviction can produce repeat reports; the runner has no external business writes or remediation side effects.

## Stop, permissions, and rollout

Set `ATLAS_SECURITY_TRIAGE_STOP=true` before invocation to prevent reads. Invalid values fail closed. Creating `ops/security/SECURITY_TRIAGE_STOP` stops the reused collector before its next request; a request already underway can last up to its timeout. Use GitHub cancel for an active hosted job.

The manual job requests only contents/security-events read access with its ephemeral token. Cross-repository security data and Dependabot alert access may be unavailable to that token; that yields explicit unknown coverage, not a recommendation to broaden production access. No credentials or settings are changed here. Local execution uses existing CLI authentication and has the same repository allowlist.

Daily scheduling and authenticated alert-webhook ingestion remain **planned and inactive**. Their activation requires separate authorization and a verified runtime/credential boundary. No public webhook endpoint, new cron trigger, alert dismissal, exploitation, patch, merge, or deployment is enabled. Proposed fix PRs require advisory review, compatible constraints, targeted tests, and your merge decision; this triage report does not claim a fix exists.

Model cost: **$0**, because no model call exists. The suggested ~$0.20 is not a charge or enforced budget. GitHub runner/artifact usage depends on the account plan. Any future paid reasoning requires separately enforced budget controls before activation.

## Actual evidence and limits

A real manual run found one open medium Dependabot alert, Atlas #17. SOC Lab code-scanning evidence was unavailable, so the report correctly returned **incomplete**. That alert has not been dismissed or repaired by this work. No absence of an alert is treated as proof of security protection or production health.

Seven focused tests cover severity ordering, duplicate suppression, sensitive-field omission, changed/unchanged evidence, missing permissions/repositories, first-page truncation, malformed records, stop-before-read, timeout handling and GET-only requests. The report does not inspect secret-scanning alerts, production logs, live Splunk alerts, or perform a complete security audit.

Rollback: revert the PR to remove B4's manual workflow branch, registry description, policy, report and tests. Existing CodeQL scan triggers remain intact, and there are no activated services or access changes to undo.
