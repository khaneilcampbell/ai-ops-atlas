# Tests: 17 scenarios before you go live

Run these in order after setup. Use your own addresses. After each test, mark the inquiry with **Close: no deal** so it does not trigger reminders. Replace YOUR-N8N and YOUR-INTAKE-KEY in the commands, or use curl-test.sh in this folder.

## Intake

1. **Happy path.** Send a normal inquiry. Expect: 200 with a ref, an owner alert within a minute, an acknowledgement at the sender address, one row in flow_inquiries and received and notified rows in flow_events.
2. **Wrong key.** Send with x-flow-key set to wrong. Expect: 401, nothing saved, no emails.
3. **No key.** Send without the header. Expect: 401.
4. **Bad email.** Send email set to not-an-email. Expect: 422, nothing saved.
5. **Short message.** Send message set to Hi. Expect: 422.
6. **Honeypot.** Send website set to http://spam.example. Expect: 422 and no emails.
7. **Duplicate.** Send test 1 again within dedupe_minutes. Expect: 200 with duplicate true, no second alert or acknowledgement.
8. **Urgent.** Send: Our system is down and we need help by tomorrow. Expect: urgency urgent, [Urgent] in the alert subject, reply due within urgent_sla_hours.
9. **Spam.** Send an obvious SEO or crypto pitch. Expect: saved with is_spam true and status spam, no alert, no acknowledgement.
10. **Booking link.** With booking_link set, check the acknowledgement shows your button label and note. Clear booking_link and repeat: the button disappears.

## Status buttons

11. **Scanner safety.** Open a status button link in a private window and close it without clicking Confirm. Expect: status unchanged.
12. **Replied.** Confirm I replied to them. Expect: status replied, a status event, no email to the client.
13. **Became a client.** On a fresh test inquiry, confirm Became a client. Expect: status won and one welcome email listing your onboarding_docs. Press it again: no second welcome email.
14. **Expired or tampered link.** Change one character of the t value in a status link and confirm. Expect: the link not valid page, no change.

## Schedules and safety nets

15. **Reminder.** Set reply_sla_hours to 0, send an inquiry, and run Flow 3 manually. Expect: one reminder email; running it again sends no second reminder. Restore reply_sla_hours.
16. **Digest.** Run Flow 4 manually. Expect: a digest with this week's test inquiries counted, spam excluded.
17. **Error alert.** In n8n, temporarily rename the flow_events table to flow_events_off, send an inquiry through the live intake URL, then rename it back. Expect: an error alert at ops_email naming Flow 1 and the failed step, with no customer data. Manual test runs never trigger error alerts, so use the live URL. If you use Flow 5, also set retention_days to 1 and run it manually on test data only.

When all 17 pass, delete the test rows from flow_inquiries and flow_events and you are live.
