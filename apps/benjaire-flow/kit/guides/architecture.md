# Architecture: how Flow fits together

Flow is six n8n workflows and three data tables. Nothing runs on Benjaire's servers; your form, your n8n, your Resend and your Anthropic account are the whole system.

## The path of one inquiry

    Website form
      -> Cloudflare Worker or your server  (bot check, field check, adds x-flow-key)
      -> Flow 1 Intake  (key check, clean fields, duplicate check)
      -> Claude  (topic, urgency, budget, summary, suggested reply, spam flag)
      -> flow_inquiries and flow_events  (saved with a reference and a one time action token)
      -> owner alert with status buttons, and acknowledgement to the sender

## The six workflows

| Workflow | Trigger | What it does |
|---|---|---|
| 0 Error alerts | Any Flow workflow fails | Emails ops_email the workflow, the step and a link to the run, with no customer data |
| 1 Intake | POST /webhook/flow-intake | Validates, deduplicates, sorts with Claude, saves, alerts and acknowledges |
| 2 Status updates | GET and POST /webhook/flow-status | Shows a confirm page, then records Replied, Became a client or Close; sends the welcome email on a first win |
| 3 Reply reminders | Weekdays 9am, 1pm and 5pm | One reminder per inquiry past its reply target |
| 4 Monday digest | Mondays 8am | Weekly summary to owner_email |
| 5 Data retention | Daily 3am, optional | Deletes records older than retention_days |

## The three tables

- **flow_settings**: one row with your business details and every setting. Workflows always read the newest row.
- **flow_inquiries**: one row per inquiry, including status, reply deadline, action token and its expiry.
- **flow_events**: an activity log: received, notified, status changes and reminders.

## Status buttons

Each inquiry gets a random 48 character token. The buttons in your alert open a confirm page first (a GET changes nothing), so email security scanners that open links cannot press them. Your click posts the form, Flow checks the reference, token and expiry, then updates the record. Tokens expire after token_ttl_days.

## Where AI is used

Claude reads the inquiry once, inside Flow 1, and returns structured labels and a draft. The draft goes only to you. If Claude is unavailable the inquiry is still saved and alerted, marked as unsorted.
