# Skyline Inquiry Assistant sandbox

This is a separate, inactive, manual-only n8n workflow. It uses synthetic input,
mock classification and captured email previews. It never sends email, calls an
AI provider or exposes a webhook. Dedicated tables must exist before execution.
No customer credentials or live table identifiers are included.

## Source and changes

Based on the saved `products/flow/live-ops/workflows/1-intake.json` export in
`khaneilcampbell/benjaire-dashboard`, source workflow version
`64069928-d7c8-47e3-b292-c89d36b9e978`. Retrieved October 30, 2026.
Comparison with the live n8n version is still pending.

The original export branches to storage and email from the same record node.
This sandbox places Save Inquiry before the notification branch, so a failed
save stops notification processing. It replaces response-time promises and
booking/status links with a fixed acknowledgement. Every delivery result is
labelled `not_sent`; captured previews do not constitute delivered email.

## Prepare n8n

1. Use a sandbox project, not the existing production workflow.
2. Create `skyline_sandbox_inquiries` with these columns:
   - String: inquiry_ref, received_at, name, email, company, phone, message,
     source, topic, urgency, status, ai_status.
   - Boolean: is_spam.
3. Create `skyline_sandbox_events` with string columns inquiry_ref, event,
   detail, at.
4. Import `workflows/inquiry-sandbox.json` from file. Keep it unpublished.
5. Check the three Data Table nodes resolve to the new tables. Re-select the
   tables and column mappings if your n8n version requires this.
6. Execute manually. Check the synthetic record and event rows, then inspect
   Alert Owner and Send Acknowledgement outputs for the two email previews.
7. Confirm both previews say `delivery_status: not_sent`.

Each manual execution creates a fresh synthetic inquiry using the execution ID.
The fixture-only key is not a secret and is not suitable for webhook access.
There is no public trigger in this workflow.

## Verification

Run `node ops/skyline/verify-sandbox.mjs` from the repository root. The checks
execute the exported validation expressions and Code nodes with synthetic
inputs. Results are saved in `validation.json`. They do not emulate the n8n
engine, prove table persistence, evaluate a real classifier, or send emails.

## Remaining work before a client pilot

- Verify the import and one full execution in n8n.
- Establish a durable inquiry ID at ingress and an atomic uniqueness constraint
  before enabling duplicate suppression under concurrent webhook delivery.
- Save the accepted inquiry before a real classifier call; the sandbox's
  classifier is a synchronous mock, not a tested failure-prone network stage.
- Replace the manual fixture with authenticated, rate-limited intake only after
  the pilot form and destination are agreed.
- Configure client-owned credentials, a verified sender, independent email
  delivery state, provider idempotency keys and bounded retries.
- Test provider failure and recovery without duplicate sends; alert the operator
  on exhausted retries. Record delivered versus merely accepted-by-provider.
- Agree and implement retention, client isolation and execution-log privacy.
- Connect runtime evidence to Atlas before marking this assistant verified.

Platform references: [n8n import/export](https://docs.n8n.io/workflows/export-import/)
and [Code node](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.code/).
