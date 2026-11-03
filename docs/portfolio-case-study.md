# Atlas case study: portfolio first, Benjaire product later

**Status: draft for KC.** This is the written case study for KC's job hunt, plus the path from
portfolio piece to a Benjaire product. Nothing here is published anywhere yet. The figures were
counted from the repository at main `d8e9189` on 2026-11-03.

It pairs with [command-center.md](command-center.md): the command center reframe is the story this
case study tells, and the product section reuses the Nov 2 business plan.

## One-line pitch

Atlas is a personal command center where every AI agent, automation and workflow KC runs is
visible as a living 3D city, with honest status, spend caps and approvals built in.

## The problem

Running a small business and a career on AI agents means dozens of moving parts: GitHub Actions,
n8n flows, Claude-powered reviewers, website workers, scheduled scouts. Each lives in a different
dashboard. Nobody can see, in one place, what is running, what failed quietly, what is costing
money, and what is waiting for a human decision.

## What KC built

- **A Mac app and a private web page from one codebase.** Tauri (Rust) on the Mac, the same React
  and TypeScript app on Cloudflare Pages behind Cloudflare Access, usable on iPhone.
- **A catalog as the single source of truth.** One YAML manifest per project (`catalog/`), with
  agents classified by type, tier, trigger, budget and owner. Tests fail on a broken manifest.
- **A 3D city as the interface.** Districts, roads, a train, an airport, buildings you can enter
  to see agents at their desks, and agents who walk to work for their shift.
- **Honest status rules.** A building lights only from a fresh, observed run. Anything not
  observed says "configured, not verified". Simulation never claims a real run.
- **Guarded write actions.** Re-run, merge and manage agents only in the Mac app, off by default,
  allow-listed, approved in a macOS dialog with Touch ID, written to an audit log, each with its
  own scoped token.
- **Cost control.** Per-agent and organization spend caps, a model tier rule (small models
  classify, large models write code), an API Usage tab separating estimated from billed cost.
- **Production discipline.** Every merge signs and ships a Mac update within about 10 minutes,
  Playwright visual checks, a map performance budget checked on every pull request, Dependabot,
  CodeQL and secret scanning, and a one-step rollback by revert.

## How it was built

Atlas was built by KC directing Claude agents through small, reviewed pull requests: one change per
pull request, tests and screenshots on each, and KC as the only person who merges. Between Oct 27
and Nov 3, 2026: 207 pull requests opened and 146 merged; about 42,000 lines of TypeScript and
React (16,000 of them the 3D map) and 16,000 lines of Rust; about 650 TypeScript tests, 77 Rust
tests and 43 Playwright visual specs (counted at main `d8e9189`). The case study should present this
honestly as a skill: specifying work, reviewing AI output, setting guardrails, and saying no
(for example rejecting a lighting change and asking for a revert, PR #170).

## Decisions worth showing an employer

| Decision | Why it matters |
|---|---|
| Read-only first, write actions later and guarded | Safe by default; every risky step needs a human |
| Observed runs only, never simulated status | Trustworthy dashboards are rarer than pretty ones |
| Secrets in Keychain, Rust makes the GitHub calls | The web layer never sees a token |
| No continuous agent loops; models only for high-value steps | Agent costs stay in single-digit dollars a month |
| Signed auto-update on every merge, rollback by revert | Treats a personal tool like production |
| Buildings become places, workflows become visible routes | Shows product thinking, not just features (see command-center.md) |

## Tailoring it to a role

The case study page itself stays role-neutral (KC, 2026-11-03), so it works for a wide range of
AI and engineering roles. The angles below are for tailoring a resume or cover letter to a
specific posting, not for the page. Examples KC named: Forward Deployed Engineer, AI Engineer
and AI Generalist.

| Role | What the hiring manager looks for | Lead with |
|---|---|---|
| **Forward Deployed Engineer** | Takes a messy real problem, builds the fix in the customer's environment, ships it fast and safely, talks to non-engineers | Atlas as a deployment for a real business (Benjaire): the inquiry pipeline from website to n8n to Claude to reply, guarded write actions, signed updates in about 10 minutes, and the plan to install it for agencies |
| **AI Engineer** | Builds production systems around models: evaluation, cost, reliability, tool use, guardrails | Model tier rule and spend caps, honest observed-run status, Repository Intelligence and Engineering Review with per-run caps, prompt-injection-safe data blocks, performance budget on every PR |
| **AI Generalist** | Range: product sense, design, automation, code, writing, using AI tools to do a team's worth of work | The whole arc: concept to Mac app, web page and iPhone in one week, the 3D city as interface, the command center reframe, directing AI coding agents with review |

It also connects to the SOC lab and the Service Desk dashboard already in the portfolio, which
help for FDE roles at security or IT-heavy customers.

## What to put in front of a recruiter

1. A 60 to 90 second screen recording: the city, a run lighting a building, an approval with
   Touch ID, the spend view. Recorded by KC on the Mac.
2. This case study as a page on khaneilcampbell.com, with four or five screenshots from
   `docs/screenshots/`.
3. The public repository link. It is public but all rights reserved (PR #119), which suits a
   portfolio: readable, not reusable.
4. Resume bullets. Use all three on a general resume, or lead with the one closest to the posting:
   - **Shipping for a real business:** Deployed an agent operations platform for my own small
     business (Benjaire), connecting its website, n8n workflows and Claude into one monitored
     pipeline, with signed updates reaching the Mac within about 10 minutes of each merge.
   - **Production AI systems:** Built guarded AI agents with per-run and monthly spend caps, a model tier
     rule (small models classify, large models write code) and status drawn only from observed runs,
     monitoring 51 registered agents and automations across 11 project manifests.
   - **Range and speed:** Took Atlas from idea to Mac app, web page and iPhone in one week by
     directing AI coding agents through 207 pull requests (146 merged), backed by about 650
     TypeScript tests, 77 Rust tests and 43 visual checks.

Before showing it publicly, the real company names in the city (Experian, BMW, Starbucks, OpenAI,
Anthropic, airline liveries and others) should be swapped for functional names in screenshots and
the recording, so nothing looks like an endorsement. The command center's "functional place
names" decision does this for free.

## From portfolio to Benjaire product

The Nov 2 business plan already sets the path, and the command center reframe makes the product
easier to explain: "see every agent and workflow your business runs, in one city, with
approvals and spend caps".

| Stage | What it is | What has to be true first |
|---|---|---|
| 1. Portfolio (now) | KC's own Atlas, case study, recording | Brand names swapped in public material |
| 2. Benjaire service | Benjaire sets up Atlas for a small agency as a done-for-you install (the plan's $1,500 to $2,500 setup) | Catalog loaded per customer, one Pages project per customer, no KC data in the build |
| 3. Benjaire Atlas product | Self-serve subscription | Multi-tenant data, a public GitHub App instead of personal tokens, notarized Mac app, billing and onboarding (the plan estimates 14 to 20 weeks) |

The business plan's kill trigger still applies: at day 90, fewer than 2 paid setups or fewer than
10 of 30 agencies reporting a costly missed-agent problem means Atlas stays a portfolio piece.

## Decisions for KC

1. **Lead role for the job hunt.** Answered 2026-11-03: keep the page neutral so it is open to a
   variety of roles; tailor per posting with the angles above.
2. **How to describe working with Claude.** Recommended: say it openly as "directed AI coding
   agents with review and guardrails", since that is the skill.
3. **Where it lives.** Recommended: a case study page on khaneilcampbell.com linking the public
   repository, plus the recording. Publishing waits for KC's OK.
