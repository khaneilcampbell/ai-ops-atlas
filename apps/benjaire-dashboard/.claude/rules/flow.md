---
paths:
  - "products/flow/**/*"
---

# Flow kit and n8n export rules

- `products/flow/kit/` is what paying buyers download. Never put Benjaire credential ids, owner or ops email addresses, the real n8n instance URL or inquiry data in it; use placeholders such as `yourname.app.n8n.cloud`. The public support address `contact@benjaire.com` is fine.
- Exports in `products/flow/live-ops/workflows/` reference credentials by n8n id and name only. Clear pinned data before exporting from n8n.
- Never commit an intake key, Resend key or Anthropic key; they live in n8n credentials and the `flow_settings` table.
- Do not commit zips. Build them with `npm run flow:pack` and attach them to a GitHub release for the `flow-vX.Y.Z` tag.
- Run `npm run ci` before every PR; it scans `products/` for secrets and checks every workflow export.
