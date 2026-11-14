# Troubleshooting

Start with the workflow's Executions tab in n8n: every run shows which step failed and why. Flow 0 also emails ops_email for failures in published workflows.

| Symptom | Likely cause | Fix |
|---|---|---|
| Form returns 401 Unauthorized | x-flow-key does not match intake_key | Copy intake_key into the Worker secret or server variable again; check for spaces |
| Form returns 422 | Invalid email, message under 10 characters, or the honeypot field was filled | Check field names; make sure the website field is hidden and empty |
| Form returns 404 | Flow 1 is not published, or the URL uses webhook-test | Publish Flow 1 and use /webhook/flow-intake |
| Worker returns 403 | The page's origin is not in ALLOWED_ORIGINS | Add each exact origin, including www if used |
| Worker says the robot check failed | Turnstile site key and secret do not match the domain | Recreate the widget for the right domain |
| No emails at all | Resend credential not selected, or the from_address domain is not verified | Select Resend API in each email node; verify the domain in Resend |
| Emails land in spam | DMARC missing or sender name changing | Follow guides/email.md |
| Alert says AI sorting unavailable | Anthropic credential missing, out of credit, or rate limited | Check the credential and your Anthropic balance; the inquiry is still saved |
| Status button page says the link is not valid | Link older than token_ttl_days, n8n_base_url wrong, or Flow 2 not published | Fix n8n_base_url (no trailing slash) and publish Flow 2; expired links can be updated in flow_inquiries by hand |
| Same person shows up twice | They changed the message, or resubmitted after dedupe_minutes | Expected; raise dedupe_minutes if needed |
| No reminders | Flow 3 not published, timezone wrong, or the inquiry already marked | Publish Flow 3 and set the workflow timezone |
| Digest arrives at the wrong hour | Workflow timezone | Set Timezone in Flow 4 settings |
| Records disappearing | Flow 5 is on with a low retention_days | Set retention_days to 0 or unpublish Flow 5 |
| Error alerts not arriving | Error workflow not set, or Flow 0 not published | Set Error workflow in Flows 1 to 5 and publish Flow 0; manual test runs never trigger it |
| Import shows missing credentials | Normal after import | Select your own credentials in each flagged node |
| Data table not found | Table name differs | Names must be exactly flow_settings, flow_inquiries and flow_events |

Still stuck? Reply to your download email with the failing workflow, the step name and the error text (remove any keys first).
