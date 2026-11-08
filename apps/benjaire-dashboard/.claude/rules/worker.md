---
paths:
  - "worker/**/*"
  - "migrations/**/*"
  - "wrangler.jsonc"
---

# Worker and data rules

- `worker/access.ts` checks RS256 signature, issuer, audience, expiry and the email allow list. Never bypass or short circuit it; add tests in `worker/access.test.ts` for any change.
- New integrations go in `worker/sources.ts` with least privilege permissions and an explicit freshness rule.
- Every D1 write goes through `worker/db.ts` and is batched with its audit entry.
- Schema changes are new numbered files in `migrations/`; never edit an applied migration.
- Never store names, emails or message bodies; n8n keeps customer data.
- Run `npm run ci` (includes the secret scan) before every PR.
