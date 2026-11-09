# Flow security notes

## Secrets
- Never in git: intake key, Resend API keys, Anthropic keys. They live only in n8n credentials and the `flow_settings` table.
- Exports in `workflows/` reference credentials by n8n id and name only.
- Rotate the intake key by adding a new `flow_settings` row and updating the caller at the same time.
- Use a Resend key limited to sending access on `benjaire.com`.

## Intake
- `x-flow-key` must match a non-empty `intake_key`, otherwise 401.
- Fields are trimmed, stripped of control characters and length-capped (message 5,000 chars).
- Email format and minimum message length are checked; the honeypot field must be empty (422 otherwise).
- Claude's prompt treats inquiry text as untrusted data: no instructions followed, no prices, dates or outcomes promised. Output is parsed defensively; if Claude fails, the inquiry is still saved and alerted without AI fields.
- Spam is only marked when Claude has confidence ≥ 0.7. Spam is saved and not answered.
- All user values are HTML-escaped before they go into emails.

## Status links
- Each inquiry gets a 48-hex one-time `action_token` (crypto random).
- GET links only render a confirm page, so email link scanners and previews cannot change state.
- POST checks the ref format, token format and allowed status, then matches ref + token in the table. Invalid means 404.
- Pages send `Cache-Control: no-store`, `noindex`, and the confirm page sends `X-Frame-Options: DENY`.
- The welcome email is sent only on the first transition to `won`.

## Operations
- Error alerts contain the workflow, failing step, error message and run link, with no customer data.
- Webhooks ignore known bots.
- Every state change is logged to `flow_events`.

## Known gaps / next steps
- No rate limiting on the intake webhook. Put the call behind the site's Cloudflare Worker (Turnstile + rate limit) before public launch.
- Tokens don't expire. Consider rejecting status changes after 90 days.
- Data retention: decide how long `flow_inquiries` keeps personal data and add a cleanup schedule plus a privacy notice on the form.
