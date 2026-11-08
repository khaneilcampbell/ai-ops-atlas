---
title: Phishing-to-Malware Response Walkthrough
subtitle: Engineering Learning Guide · sec-02
---

| Project ID | Purpose of this guide | Last verified |
|---|---|---|
| sec-02 | Prepare the concepts this lab will need | 2026-10-26 |

**Labels.** These are general explanations. There are no "Example from your project" entries because the lab has not been built.

# 1. Concepts This Lab Will Teach

## Phishing triage

**Beginner.** Check headers, sender, links and attachments; decide whether others received the same message.

**Enterprise application.** Email security teams pull every copy of a malicious message across the organisation and block its indicators.

## Host process review

**Beginner.** Look for unexpected processes, parents and network connections with Sysinternals Process Explorer and Autoruns.

**Enterprise application.** EDR tools automate this, but analysts still read process trees to confirm.

## Persistence

**Beginner.** Malware arranges to survive a reboot: run keys, scheduled tasks, services.

**Enterprise application.** Autoruns and Event IDs such as 4698 (scheduled task created) and 7045 (service installed) are standard checks.

## Containment

**Beginner.** Isolate the host, reset credentials, block indicators, preserve evidence.

**Enterprise application.** Follows the NIST incident response lifecycle: preparation, detection and analysis, containment, eradication and recovery, post-incident.

# 2. What You Need to Explain in a Technical Interview

Each of the concepts above, with an example from the lab once it exists.

# Test Your Understanding

1. What evidence would link the email to the host's behaviour?
2. Name three Windows persistence locations and how you would check them.
3. Why preserve evidence before wiping a host?
4. What goes in an incident summary for people who were not there?
5. Which NIST phase does isolating the host belong to?
