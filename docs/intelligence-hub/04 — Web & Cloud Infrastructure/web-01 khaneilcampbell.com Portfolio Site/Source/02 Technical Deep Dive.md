---
title: khaneilcampbell.com Portfolio Site
subtitle: Technical Deep Dive · web-01
---

| Project ID | Scope of this document | Last verified |
|---|---|---|
| web-01 | How the site is built, secured, deployed and checked | 2026-10-26 |

**Labels.** **[Verified]** read in the repository · **[Inferred]** my reasoning · **[Recommended]** a suggestion.

# 1. System Architecture

![Hosting and change flow](architecture.png){width=100%}

[Verified] 14 static HTML pages at the repository root, one stylesheet, one script, fonts and images under `assets/` and `images/`. GitHub Pages serves `main`; Cloudflare handles the domain and email routing.

# 2. Components

| Component | Path | Responsibility |
|---|---|---|
| Pages | `*.html` | Home, About, Work, two case studies, labs index and details, Contact, four credential pages, Privacy, 404 |
| Design system | `assets/site.css` | Tokens, layout, the `.ad` architecture-diagram component |
| Enhancement | `assets/site.js` | Reveals, mobile menu, magnetic buttons, diagram inspector with keyboard support |
| Fonts | `assets/fonts/` | Instrument Sans and Serif, Latin subset, SIL OFL 1.1 |
| Crawl | `robots.txt`, `sitemap.xml` | Search engine directives |
| Audits | `scripts/` | `site_audit.py`, `site_inventory.py`, `security-check.sh` |
| Planning | `docs/VISION.md`, `docs/PORTFOLIO-PLAN.md` | Positioning, verified content, decisions |

# 3. Integrations

[Verified] None at runtime. The CSP sets `connect-src 'none'` and `form-action 'none'`, so the site cannot call any API or submit a form.

# 4. Authentication

[Verified] None. Contact is through email links.

# 5. Data Flows

[Verified] Browser requests static files from GitHub Pages. No data leaves the browser.

# 6. Structures

[Verified] Every page carries: a CSP meta tag, a referrer policy, canonical and Open Graph tags, JSON-LD (`WebPage` linked to a site-wide `Person`, plus `BreadcrumbList`), and `rel="noopener noreferrer"` on any `target="_blank"` link.

Content Security Policy on `index.html`:

```
default-src 'none'; script-src 'self'; style-src 'self'; font-src 'self';
img-src 'self' data:; manifest-src 'self'; connect-src 'none';
base-uri 'self'; form-action 'none';
```

# 7. Error Handling

[Verified] A custom `404.html`. Every feature degrades to plain HTML when JavaScript is off or `prefers-reduced-motion` is set.

# 8. Monitoring

[Verified] None beyond CI. No analytics by design.

# 9. Security Considerations

| Control | State | Label |
|---|---|---|
| Strict CSP, no inline scripts or styles | Implemented | Verified |
| No third-party origins | Implemented | Verified |
| Referrer policy on every page | Implemented and checked in CI | Verified |
| Real HTTP security headers | Not possible on GitHub Pages; `_headers` is for a future host | Verified |
| Public résumé without phone number | Implemented | Verified |
| CI action pinned by tag (`actions/checkout@v4`), not by SHA | Open | Verified |

# 10. Deployment Architecture

[Verified] Squash-merged pull requests to `main`; GitHub Pages publishes automatically; `CNAME` sets the domain. Assets are cached for ten minutes, which is why URLs carry a content hash.

# 11. Testing Methodology

[Verified] CI: CSP, referrer policy and `noopener` checks on every HTML file. Locally: `site_audit.py` (credential-shaped strings, missing `alt`, insecure links, broken local links) and `security-check.sh`. I ran both on `docs/portfolio-review` on 2026-10-26: 14 pages, 0 failures, 0 warnings; 133 checks passed.

# 12. Troubleshooting Procedures

| Symptom | Cause | Fix |
|---|---|---|
| New layout with old styling | Hash in CSS URL not updated | Recompute the hash and update the link |
| Style silently ignored | Inline `style` blocked by CSP | Move it to a class in `site.css` |
| CI fails "Missing CSP meta tag" | New page without the head block | Copy the head from an existing page |
| Font fails to load | Font not in `assets/fonts/` | Self-host it; CSP blocks other origins |

# 13. Performance Considerations

[Verified] Inline SVG covers and self-hosted subset fonts keep requests low; two upright faces are preloaded.

# 14. Future Engineering Improvements

[Recommended] Run `site_audit.py` in CI; pin actions by SHA; move to a host that sends real headers (Cloudflare Pages, decision D4) if header-only policies matter; add a writing section.
