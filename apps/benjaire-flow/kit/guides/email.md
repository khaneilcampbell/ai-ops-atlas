# Email: sending from your own domain

Flow sends every email through Resend from your address, so clients see your name and replies come back to you.

## 1. Verify your domain in Resend

1. Sign in at resend.com, open Domains, Add domain. Using a subdomain such as mail.acme.com keeps your main domain's settings untouched, but your root domain works too.
2. Add the DNS records Resend shows (an MX and TXT record for the bounce path and a DKIM TXT record) at your DNS host.
3. Wait for every record to show Verified.

## 2. SPF, DKIM and DMARC

- **SPF and DKIM** are covered by the records Resend gives you. Do not add a second SPF record to the same name; merge into one if you already have one.
- **DMARC**: if your domain has no DMARC record, add a TXT record at _dmarc.yourdomain.com with: v=DMARC1; p=none; rua=mailto:you@yourdomain.com. Move to p=quarantine once you have seen a few clean reports.

## 3. Create the API key

API Keys, Create API key, Sending access, restricted to your domain. Paste it into the n8n Bearer Auth credential named Resend API.

## 4. Settings that control email

- from_address: the sender, for example Acme Advisory <hello@acme.com>. The domain must match a verified Resend domain.
- reply_to_email: where replies go. It can be a different inbox from the sender.
- owner_email and ops_email: where your own alerts go. These can be any address.
- logo_url: a PNG on a public https address, sized for a dark header. Leave blank to show your name in text.

## What gets sent

| Email | To | When |
|---|---|---|
| Acknowledgement | The sender | Each new, non spam inquiry |
| New inquiry alert | owner_email | Each new, non spam inquiry |
| Welcome and onboarding | The client | The first time you mark them Became a client |
| Reply reminder | owner_email | Weekdays at 9am, 1pm and 5pm, once per overdue inquiry |
| Monday digest | owner_email | Mondays at 8am |
| Error alert | ops_email | When any Flow workflow fails |

## Deliverability tips

- Send a test to a Gmail and an Outlook address and check that both land in the inbox.
- Keep the sender name stable. Changing it often hurts reputation.
- If alerts to yourself land in spam, mark them Not spam once and add the sender to your contacts.
