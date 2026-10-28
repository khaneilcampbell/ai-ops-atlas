# Senior Engineering Reviewer

The second Claude agent in Atlas. Where Repository Intelligence looks at one repository, the reviewer looks at the whole ecosystem at once: every catalog repository, its CI, dependencies and security settings, the agents and their autonomy levels, and Atlas itself. It returns a scorecard, top risks, ranked recommendations, suggested tools, autonomy notes and quick wins. It is **autonomy Level 1**: it recommends and changes nothing.

Open it from **Intel → Engineering review**. Settings are in **Settings → Repository intelligence → Engineering review**.

## Pipeline

```
Catalog (from the web view) → facts per repository (saved reports reused when under 7 days old)
  → extra checks (Dependabot config, CODEOWNERS, branch rules, workflow scan) → prompt
  → reuse check → budget check → Claude (one request) → validate → save → show in Atlas
```

Code: `src-tauri/src/intel/review.rs` (collection, checks, prompt, schema, validation) and the review pipeline in `src-tauri/src/intel/jobs.rs`. It shares the Repository Intelligence queue (one Claude request at a time), run log, Keychain key, models, prices and monthly budget. UI: `src/views/EngineeringReview.tsx` and `src/intel/ecosystem.ts`.

## What it reads

- **Catalog:** projects and agents with type, autonomy level, trigger, permissions, approval, risk, and whether Atlas has a live source for them.
- **Per repository:** the verified facts from a saved Repository Intelligence report if fresh, otherwise a quick read (about 10 GETs).
- **Extra checks, computed in code:** `.github/dependabot.yml`, Renovate config, CODEOWNERS, branch rules on the default branch (rulesets, readable with read access, and classic protection, which usually needs admin; shown as not assessed when neither answers), and up to 6 workflow files scanned for a missing `permissions:` block, write scopes, unpinned third-party actions, `pull_request_target`, timeouts, concurrency and cron schedules.
- **Never:** secret-scanning alerts, source files, repositories outside the catalog. Every request goes through the app's GET-only allowlist.

## Cost

| Depth | Model (default) | Input budget | Max output | Worst case |
|---|---|---|---|---|
| Quick | Haiku 5.5 | 20k | 8k | about $0.01 |
| Standard | Sonnet 5.5 | 30k | 16k | about $0.22 |
| Deep | Opus 5.5 | 40k | 16k | about $0.48 |

Its own per-review limit (default $0.60) and the shared monthly budget are checked before anything is sent, and the worst case is shown before you confirm. If the data hasn't changed since the last review, the review is reused with no Claude call. When the data is too big for the budget, per-repository detail is dropped in steps instead of failing.

## Output and validation

The model must answer with JSON matching a closed schema (extra fields are rejected). Citations to ids not in the data are removed and the item is marked "no supporting reference". Repository names and agent ids not in the catalog are removed, and autonomy levels outside 0 to 4 are dropped. Verified facts and Claude's review are shown in separate, labelled sections. A failed or blocked run never replaces the last good review; it is kept and marked out of date.

The full system prompt is `SYSTEM_PROMPT` in `review.rs`. Changing it or the schema means bumping `REVIEW_PROMPT_VERSION`.

## Schedule

Off by default. When turned on (with an explicit confirmation), it runs on the chosen days at the chosen time (preset Monday 08:00), only while the app is open, using the catalog as it was at the last manual review. It stops when the monthly budget is used up and never overlaps a running review.
