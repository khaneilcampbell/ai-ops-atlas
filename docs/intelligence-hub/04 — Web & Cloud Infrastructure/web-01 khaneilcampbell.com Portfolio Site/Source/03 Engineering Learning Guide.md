---
title: khaneilcampbell.com Portfolio Site
subtitle: Engineering Learning Guide · web-01
---

| Project ID | Purpose of this guide | Last verified |
|---|---|---|
| web-01 | Understand the site's engineering well enough to explain and extend it without AI | 2026-10-26 |

**Labels.** General explanations are background knowledge; every "Example from your project" is **[Verified]**.

# 1. Engineering Concepts This Project Teaches

| Concept | Where it shows up |
|---|---|
| Content Security Policy | Meta tag on every page |
| Progressive enhancement | `site.js` is optional |
| Accessibility | Contrast ratios in the README, keyboard-operable diagrams, reduced motion |
| Caching and cache-busting | Content hash in asset URLs |
| SEO metadata and structured data | Titles, descriptions, JSON-LD |
| CI for static sites | `security-check.yml` |
| DNS and static hosting | Cloudflare and GitHub Pages |

# 2. How the Major Components Work

## Content Security Policy

**Beginner.** A list, sent with the page, of where the browser may load things from. Anything else is blocked.

**Intermediate.** Directives per resource type: `script-src`, `style-src`, `img-src` and so on. `default-src 'none'` blocks everything not explicitly allowed. Blocking inline scripts is what stops most cross-site scripting.

**Enterprise application.** Companies roll out CSP in report-only mode first, then enforce it, usually as an HTTP header.

**Example from your project.** [Verified] `default-src 'none'; script-src 'self'; style-src 'self'; … connect-src 'none'; form-action 'none'`, set by a meta tag because GitHub Pages cannot send custom headers.

## Progressive enhancement

**Beginner.** Build the page so it works plainly first, then add extras for browsers that can run them.

**Example from your project.** [Verified] The architecture diagrams are HTML lists with links to detail cards; JavaScript adds the inspector panel and keyboard navigation.

## Cache-busting

**Beginner.** Browsers keep copies of files. If the file changes but its name does not, visitors can see the old one.

**Example from your project.** [Verified] `assets/site.css?v=<hash>`; the README gives the one-line Python command that computes the hash.

# 3. Why These Tools

| Choice | Why | Trade-off |
|---|---|---|
| Static HTML | Fast, secure, free to host | Repeated header and footer markup |
| GitHub Pages | Deploys on merge | No custom headers |
| Cloudflare DNS | Free, reliable, email routing | DNS is split from hosting |

# 4. What Happens Behind the Scenes

When a visitor opens the site, Cloudflare's DNS returns GitHub Pages' address; GitHub serves the HTML; the browser reads the CSP meta tag before loading anything else, then fetches only same-origin CSS, JS, fonts and images.

# 5. The Most Important Code Structures

- The head block repeated on every page (CSP, referrer, canonical, Open Graph, JSON-LD).
- `.ad` diagram markup in the case studies and its styles in `site.css`.
- `site_audit.py`'s HTML parser checks.

# 6. How Data Moves

Static files only; see the Deep Dive, section 5.

# 7. Common Failures You Should Understand

| Failure | What it teaches |
|---|---|
| Inline style ignored | How CSP `style-src` works |
| Stale CSS after deploy | Caching and versioned URLs |
| `_headers` has no effect | Hosting platforms differ in what they honour |
| Contrast failure | Accessibility is measurable |

# 8. How an Experienced Engineer Would Approach It

[Recommended] Template the shared head and footer with a tiny build step or include system once pages multiply; enforce CSP as a header on a host that supports it; run the full audit and a link checker in CI; add Lighthouse accessibility checks.

# 9. What You Need to Explain in a Technical Interview

1. Why `default-src 'none'` and what each allowed directive permits.
2. Why the CSP is a meta tag here and what that cannot do.
3. How the site works without JavaScript.
4. Why the asset URLs carry a hash.
5. How you verify every claim on the site.

# 10. What to Learn Next

- HTTP security headers in depth (HSTS, `frame-ancestors`, Permissions-Policy).
- Static site generators (Astro was proposed in the plan).
- Web performance metrics (Core Web Vitals).

# Test Your Understanding

1. Which CSP directive stops the site from calling any API, and which stops form submissions?
2. What would happen if you added `style="color:red"` to an element, and why?
3. Why does the README say `_headers` is not enforced?
4. What does `site_audit.py` check that the CI workflow does not?
5. How would you change the stylesheet without visitors seeing a broken page?

*Answers: Deep Dive 6; Learning Guide 2; Deep Dive 9; Deep Dive 11; Learning Guide 2.*
