# Skyline: Benjaire Inquiry Assistant

Status: sandbox prepared and locally checked; not deployed. Updated October 30, 2026.

Skyline is the business operations district. Its first proposed service uses the
Benjaire Flow intake pattern documented in `catalog/benjaire-com.yaml`. The Skyline
registration is a planned service, not a second running copy of Benjaire Flow.
Atlas catalogs and observes workflows; this manifest does not execute them.

## Offer

One website form, one business inbox, an inquiry log, owner notifications and
fixed acknowledgement emails. CRM integration, appointment booking, additional
forms and additional channels require a separate scope.

Proposed pilot price: $750 setup and $149/month, subject to validation with a
customer. Client pays platform subscriptions directly. Proposed initial limit:
250 accepted inquiries/month. Review volume and agree an upgrade before raising
the limit; never silently discard accepted inquiries. Monthly support includes
workflow checks and one configuration adjustment of up to 30 minutes; larger
changes are quoted separately. Do not promise round-the-clock support or sales results.

## Initial workflow

1. Validate the form submission, origin, anti-spam control and request size.
2. Assign an inquiry ID and persist the accepted inquiry before sending email.
3. Classify topic and urgency; uncertain or failed classifications go to manual
   review without losing the inquiry. Treat submission text as untrusted data.
4. Send an owner alert and a fixed acknowledgement with separately tracked status.
5. Retry transient email failures with a bounded policy. Alert the operator when
   delivery remains unsuccessful. Retries must not duplicate records or emails.

No automated quoting, booking, promises of availability or sales follow-up is
included. Keep client records and credentials isolated from other clients.

## Setup sequence

- [x] Register Skyline and the planned assistant in Atlas.
- [x] Define the initial commercial scope and acceptance checks.
- [x] Retrieve the saved Benjaire Flow export and prepare a separate manual-only sandbox.
- [x] Run local validation of sandbox routing, validation expressions and Code nodes (10 checks passed).
- [ ] Obtain the current Benjaire Flow export and compare it with the deployed version.
- [ ] Select the pilot business, website form, destination inbox and client-owned accounts.
- [ ] Confirm expected volume, allowed data fields and deletion period with the client.
- [ ] Build a sandbox copy using synthetic inquiries and test email recipients.
- [ ] Configure secrets in the workflow platform, never in manifests or source files.
- [ ] Add status-link expiry if status links are used; document the retention schedule.
- [ ] Pass acceptance checks and record evidence below.
- [ ] Connect the approved website and verify one controlled production submission.
- [ ] Connect execution telemetry to Atlas; only then describe the service as verified running.

## Acceptance checks

| Scenario | Required result |
| --- | --- |
| Valid inquiry | One log record, owner alert and sender acknowledgement |
| Duplicate submission or retry | One inquiry record; each intended email sent once |
| Invalid input or spam | Rejected or quarantined with no unintended email |
| Classifier unavailable or uncertain | Inquiry retained and routed for manual review |
| Email provider unavailable | Inquiry retained, delivery pending, bounded retries and operator alert |
| Submission contains instructions | Text cannot change workflow rules, recipients or tool access |
| Rate limit reached | Clear retry response; no accepted inquiry silently lost |
| Expired status link, if used | Access denied without changing the inquiry |
| Retention deadline | Inquiry data deleted according to the agreed schedule |
| Second client | Cannot read or modify the first client's records |

Local evidence: `ops/skyline/validation.json` records 10 passing checks against the
exported Code nodes, validation expressions and notification routing. The
importable workflow is `ops/skyline/workflows/inquiry-sandbox.json`; table setup
and import instructions are in `ops/skyline/README.md`.

The sandbox uses synthetic input, mocked classification and email previews.
It has no webhook, credentials, model API calls or outgoing email. It writes only
to dedicated sandbox tables after those tables are created in n8n. No n8n engine
execution, persisted test row, real email delivery or customer revenue has been
verified. Live-workspace access is required for the next step.

## Pilot record

Business: pending. Form URL: pending. Destination inbox: pending.
Platform account owner: pending. Retention period: pending.
Acceptance date: pending. Support contact: pending.

Track setup payment, subscription payment, platform costs, delivery hours,
support hours, accepted inquiries and failed deliveries. Revenue remains zero
until an actual payment is verified; proposed pricing is not revenue.
