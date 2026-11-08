# Security

Flow handles personal data from the public. These are the protections built in and the ones you should keep in place.

## Built in

- **Intake key.** Flow 1 rejects any request without the correct x-flow-key header. The key lives in your Worker or server, never in page source.
- **Honeypot and validation.** A hidden field catches simple bots; email format and message length are checked before anything is stored or sent to Claude.
- **Duplicate guard.** Identical resubmissions within dedupe_minutes are acknowledged but not processed again, so a double click does not mean two alerts.
- **Untrusted input handling.** Every field is trimmed and length limited, and everything shown in emails and pages is HTML escaped. Claude is told that the inquiry is untrusted data and never to follow instructions inside it, and its draft goes only to you.
- **No automatic AI replies.** Prospects only ever receive your fixed acknowledgement and, after your click, your welcome email.
- **Scanner safe status links.** Buttons open a confirm page; only a POST with the right reference and 48 character token changes anything, and tokens expire after token_ttl_days.
- **No customer data in error alerts.** Flow 0 reports the workflow, step and a run link only.
- **Your accounts only.** Data stays in your n8n data tables. Benjaire never receives your inquiries or your keys.

## Your responsibilities

- Use a long random intake_key and rotate it if it is ever exposed: update flow_settings and the Worker secret together.
- Turn on Turnstile and a rate limit for the form endpoint (guides/cloudflare.md).
- Restrict your Resend API key to sending, and your n8n account with two factor authentication.
- Limit who has access to your n8n project: anyone with access can read inquiries.
- Set retention_days if you only need records for a limited time, and mention inquiry handling in your privacy policy.
- Keep n8n updated if you self host.

## Rotating the intake key

1. Generate a new key: openssl rand -hex 24
2. Update FLOW_INTAKE_KEY in the Worker (or your server) and intake_key in flow_settings within a minute of each other.
3. Send a test inquiry.

## Reporting a problem

If you find a security issue in Flow, reply to your download email with details. Do not include real customer data.
