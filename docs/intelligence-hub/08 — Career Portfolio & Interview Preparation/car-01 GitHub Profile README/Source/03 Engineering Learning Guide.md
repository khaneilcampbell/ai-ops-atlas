---
title: GitHub Profile README
subtitle: Engineering Learning Guide · car-01
---

| Project ID | Purpose of this guide | Last verified |
|---|---|---|
| car-01 | Understand how the profile works and keep it accurate | 2026-10-26 |

**Labels.** General explanations are background knowledge; every "Example from your project" is **[Verified]**.

# 1. Engineering Concepts This Project Teaches

| Concept | Where it shows up |
|---|---|
| Special profile repositories | `khaneilcampbell/khancam15` |
| Repository renames and redirects | Link changes on the docs branch |
| Visibility (public and private) | au-01 link |
| Single source of truth | Profile versus portfolio site |

# 2. How the Major Components Work

## Profile repository

**Beginner.** A public repository with the same name as your username; its README appears on your profile.

**Example from your project.** [Verified] `khaneilcampbell/khancam15`, created 2026-10-12.

## Renames and redirects

**Beginner.** When you rename a repository, GitHub redirects the old URL to the new one.

**Intermediate.** The redirect breaks if a new repository takes the old name. A typo in a link is not a redirect; it only works if a repository ever had that exact name.

**Enterprise application.** Teams keep link checkers in CI for documentation sites for this reason.

**Example from your project.** [Verified] `main` uses `soc-automation-splunk-bruteforce-lab`; the docs branch uses `ssplunk-bruteforce-detection-lab`; the repository is `splunk-bruteforce-detection-lab`.

## Visibility

**Beginner.** A private repository is invisible to everyone you have not invited. Signed in, you see it; visitors see a 404.

**Example from your project.** [Verified] The docs branch features au-01, whose repository is now private.

## Single source of truth

**Beginner.** When the same facts appear in two places, they drift.

**Example from your project.** [Verified] Commit e59d20c exists only to bring the profile back in line with the portfolio site.

# 3–7. Tools, Behind the Scenes, Code, Data, Failures

Covered above: Markdown rendered by GitHub; the only failure modes are stale facts and broken links.

# 8. How an Experienced Engineer Would Approach It

Treat the profile like documentation: one owner page for facts (the portfolio site), the profile as a summary, and a link check before each merge.

# 9. What You Need to Explain in a Technical Interview

- Why each featured project is on the list and what it proves.
- How you keep public claims accurate across profile, site and repositories.

# 10. What to Learn Next

GitHub Actions basics with a Markdown link checker such as `lychee`.

# Test Your Understanding

1. Why does GitHub show this README on your profile?
2. What does a visitor see when they click a link to a private repository?
3. When does a renamed repository's old URL stop redirecting?
4. Which file is the source of truth for your project descriptions, and how do you keep the profile in step?
5. How would you test the docs branch's links as an outside visitor would?
