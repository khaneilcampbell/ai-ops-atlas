# Manual business-readiness slice

This implements the first architecture milestone only: a local, model-free campaign-readiness packet across HQ → Agency → Marketplace → HQ reporting. It does not execute registered agents, n8n, payments, publishing, messaging or Atlas feed writes. No schedule or dependency is added. Existing Product Lab registrations are reused as responsibility references, not execution evidence. Production workers and their ownership are unchanged.

Run the clearly labeled synthetic fixture:

```sh
python3 ops/benjaire-production/readiness.py --brief ops/benjaire-production/fixtures/readiness.json --state-root .local/benjaire-production/readiness
```

Inspect the printed `packet.json` and adjacent `report.md` / `supplied.json`. State is **awaiting approval**, product readiness is **blocked**, and publication remains unauthorized. Supplied source URLs have not been fetched or verified by this runner. This packet cannot authorize an action, even if manually edited. There is intentionally no approve/publish switch. The existing supplied-product handoff remains separate.

Inputs are bounded, allowlisted records without customer data or credentials. Keep real briefs and outputs outside Git under the private local state root. Directories and files created by this runner use owner-only permissions; use a trusted existing private root without symlinks. Local files are not a multi-user security boundary. Research URLs reject embedded credentials and query strings, but this is not a general secret detector; never supply secrets. No raw inputs are sent anywhere.

An immutable brief hash plus contract version identifies a revision. Duplicate runs reuse an intact packet; edited packet states are rejected. Changed briefs create separate revisions, preserving prior evidence. Exclusive per-objective locking prevents concurrent local work. After a crash, verify no process is running before removing that objective's stale `.lock`; never steal another process's lock. Re-run to resume. Generate packet.json last so incomplete artifacts can be rebuilt.

Stop new work with `BENJAIRE_PRODUCTION_STOP=true` or `<state-root>/STOP`. Invalid stop settings refuse execution. There is no background worker, retry loop or network wait. Bounded synchronous input is processed in one local invocation.

Validation: `python3 -m unittest discover -s ops/benjaire-production -p 'test_*.py'` covers domain handoff, invalid input, authorization injection, source constraints, duplicate reuse, changed revisions, tampering, stop controls, locks and size limits. Existing handoff tests remain included. This is fixture validation, not a verified commercial outcome.

Next gates: verify installed n8n version and published exports; implement authenticated durable approval/event storage; independently validate checkout/fulfillment in an authorized test environment; add a schema-reviewed read-only Atlas adapter. This packet is not accepted directly by current Atlas report endpoints. Paid calls stay disabled until durable budget enforcement exists. No real brief, provider execution or integration is claimed.

Rollback: remove this runner and fixture through the PR revert; retain local artifacts for review. Existing workflows and customer fulfillment are unaffected.
