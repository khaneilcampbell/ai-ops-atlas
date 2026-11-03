---
title: Access Control and Account Lifecycle
subtitle: Engineering Learning Guide · sec-03
---

| Project ID | Purpose of this guide | Last verified |
|---|---|---|
| sec-03 | Prepare the concepts this lab will need | 2026-10-26 |

**Labels.** These are general explanations. There are no "Example from your project" entries because the lab has not been built.

# 1. Concepts This Lab Will Teach

## Least privilege

**Beginner.** Give each account only the access its job needs.

**Enterprise application.** Quarterly access reviews and role-based groups keep permissions from creeping.

## Account lifecycle (joiner, mover, leaver)

**Beginner.** Create, change and remove access as people join, change roles and leave.

**Enterprise application.** Identity governance tools tie lifecycle events to HR records.

## Identity verification for recovery

**Beginner.** Confirm who is asking before resetting a password or MFA, using a channel the requester does not control.

**Enterprise application.** Help desks are a common social engineering target; urgency and seniority are classic pressure tactics.

## MFA enforcement

**Beginner.** Require a second factor; prefer phishing-resistant methods.

**Enterprise application.** Conditional access policies and Cisco Duo-style enrolment checks.

# 2. What You Need to Explain in a Technical Interview

Each of the concepts above, with an example from the lab once it exists.

# Test Your Understanding

1. Why is urgency from a senior person a red flag in a recovery request?
2. What should happen to an account on a person's last day?
3. How would you find accounts with more access than their role needs?
4. Which verification channel is safe for an MFA reset, and why?
5. What should every access approval record contain?
