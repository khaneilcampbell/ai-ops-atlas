# Repository Intelligence Agent

The first AI agent inside Atlas. You pick a repository, it reads that repository from GitHub (read-only), asks Claude for a structured assessment, validates the answer and saves a report on your Mac. Facts that code can establish are shown as verified; everything Claude writes is labeled as an unverified assessment.

```
Select repository → Collect GitHub data → Compute facts → Build prompt → Reuse check
  → Budget check → Claude (one request, bounded retries) → Validate → Save report → Show in Atlas
```

## 1. Architecture audit (before this change)

| Area | What existed | Used for the agent |
|---|---|---|
| Framework | Tauri 2: Rust shell, React 18 + TypeScript web view, Vite, npm. Cargo for Rust | Kept. No new framework |
| GitHub access | Rust command `github_get`: GET only, path allowlist (`/repos/...` and repo lists), token from the Keychain attached on the Rust side | Reused. The agent calls the same function, so the same allowlist and GET-only rule apply |
| Authentication | GitHub token in the macOS Keychain (`keyring` crate), never returned to the web view | Extended with a second Keychain entry for the Anthropic key |
| Repository discovery | TypeScript: owner repo listing, catalog manifests, ETag caching, push-gated refetch, rate-limit budget | Unchanged. The agent only analyzes repositories you pick |
| Workflow history | Repo-wide Actions run list plus per-workflow runs for observed agents (TypeScript) | The agent reads `/actions/runs` itself and derives CI state in Rust |
| Agent model | Agents declared in `catalog/*.yaml`; status and `last_run` are hand-written | The new agent is added to `catalog/ai-ops-atlas.yaml`. Its live state comes from its own run history |
| Storage | Browser `localStorage` for preferences and caches | Agent data goes to JSON files in the app data folder instead, because the Rust side owns it and it must survive web view resets |
| Background work | None. A refresh timer in the web view, paused while hidden | New: a Rust-side job runner and an opt-in, app-local scheduler |
| Security controls | CSP, `opener` limited to `https://`, Dependabot, secret scanning, CodeQL, cargo/npm audit in CI | Unchanged CSP: the web view still makes no network calls of its own for the agent |

No database was added: one report per repository and a few hundred run records fit in small JSON files written atomically.

## 2. Modules

All agent logic is in Rust, in `src-tauri/src/intel/`. Each stage is its own module with its own tests.

| Module | Responsibility |
|---|---|
| `collect.rs` | GitHub reads for one repository through the `GithubApi` trait (which only has `get`). Computes deterministic facts (CI state, activity, issues, releases, docs, languages, stack, alerts) and verified findings |
| `prompt.rs` | Sanitizes repository text, fences it in one `<repository_data>` block, assigns citable reference ids, trims to the token budget, builds the request and the JSON Schema |
| `claude.rs` | Messages API client (raw HTTP; there is no official Anthropic SDK for Rust). Timeouts, exponential backoff with jitter, `retry-after`, error classification, refusal and truncation handling, usage parsing |
| `validate.rs` | Strict parse (`deny_unknown_fields`), size limits, and citation checks: references the model invents are removed and the item is flagged as ungrounded |
| `cost.rs` | Pricing, per-response cost, monthly spend, worst-case checks against the per-run and monthly limits |
| `store.rs` | JSON files: `config.json`, `runs.json`, `reports/<owner>__<repo>.json`; interrupted-run recovery |
| `jobs.rs` | The pipeline, the queue (one Claude-bound job at a time), de-duplication, cancellation, run traces and the scheduler |
| `mod.rs` | Tauri commands and app setup |

The web view side (`src/intel/`, `src/components/IntelPanel.tsx`, `src/views/Intelligence.tsx`, `src/views/IntelSettings.tsx`) only calls Tauri commands and renders.

## 3. What a report contains

- **Verified (from GitHub, computed in code):** name, URL, description, visibility, default branch, languages, technologies detected from root files and manifests, AI/agent libraries found in manifests, recent commits and authors, branches, open PRs and issues, latest release, latest run of each workflow and the CI state, README/license/CONTRIBUTING/CHANGELOG/docs presence, Dependabot and code-scanning alerts, and findings derived from those (failing CI, open alerts, missing README or license, no commits in 180 days, archived).
- **Claude's assessment (unverified):** summary, purpose, architecture, maturity, implementation status, health ratings, maintenance issues, documentation gaps, technical-debt indicators, security observations (always hypotheses), prioritized recommendations, and what couldn't be assessed. Every item carries the reference ids it cites, and items without a valid reference are marked "no supporting reference".
- **Known agent integrations:** the catalog's agents for the repository (from the manifests) plus AI libraries detected in manifests, plus what Claude infers.
- **States:** `analyzed`, `reused` (nothing changed), `insufficient_data` (empty repository, no call made), `stale` (newer data, but the latest attempt failed or was blocked; the older analysis is shown with a note), `not_assessed`. Sections GitHub refuses (for example alerts without permission) are shown as "not assessed" with GitHub's reason, never guessed.
- **Last successful analysis timestamp** and the model that produced it.

A failed run never replaces a good analysis and is never shown as a success: the run is recorded as failed, and the report says the analysis is out of date.

## 4. Cost controls

Defaults are conservative and all of them are editable in **Settings → Repository intelligence** without a code change.

| Depth | Model (default) | Input budget | Max output | Effort | Worst case per run |
|---|---|---|---|---|---|
| Quick | `claude-haiku-5-5` | 6k tokens | 4k | low | about $0.003 |
| Standard (default) | `claude-sonnet-5-5` | 12k tokens | 8k | low | about $0.10 |
| Deep | `claude-opus-5-5` | 24k tokens | 12k | medium | about $0.34 |

Prices are Anthropic list prices as of 2026-10-06 (US$ per million tokens: Haiku 5.5 $0.10/$0.50, Sonnet 5.5 $2/$10, Opus 5.5 $4/$20). Real runs usually cost a fraction of the worst case.

- **Per-run limit** (default $0.40) and **monthly budget** (default $5.00). Before any request, the worst case (estimated input plus the full output allowance) is checked against both. If either would be exceeded, the run is blocked and nothing is sent.
- **Incremental analysis:** the prompt's data block is hashed with the model, depth and prompt version. If the hash matches the last successful analysis (same commits, issues, CI results, alerts, README and manifests), the analysis is reused with no Claude call. A new day alone doesn't change the hash. "Re-analyze anyway" forces a call.
- **Deterministic first:** commit dates, CI state, alert counts and file presence are computed in Rust. Claude only gets the reasoning work.
- **One request per run:** no agent loop and no tools. Retries are capped (default 3 attempts) and only for rate limits, overloads, server errors, timeouts and network errors.
- **No duplicate jobs:** a repository with a queued or running job returns that job instead of starting another. One Claude request runs at a time.
- **Cancellation:** queued jobs are cancelled before they start; a running job is abandoned at the next step or mid-request (Anthropic may still bill a request that was already in flight, and the trace says so).
- **Accounting:** token counts are as reported by Anthropic (including per-attempt usage when a safety fallback runs). Dollar amounts are estimates from those counts and the configured prices, and the UI labels them that way. The Anthropic Console has the billed figures.
- **Safety fallback:** for Sonnet 5.5 and Opus 5.5, requests send `fallbacks: "default"` so a safety decline is retried server-side on another model, which matters for security-focused repositories. The run records which model answered and prices that attempt at its rates. It can be turned off in Settings.

## 5. Security and read-only guarantees

- **GitHub:** the agent's only GitHub interface is `GithubApi::get`, implemented by the existing `github::get`, which rejects anything but GET to allowlisted paths. Repository names are validated before any request, and only the selected repository's paths are read. It never commits, opens or edits issues or PRs, triggers workflows, or changes settings. Tests fail if the agent builds a path outside the allowlist or the selected repository.
- **Least privilege:** use a fine-grained GitHub token limited to the repositories you want analyzed, with read-only **Metadata**, **Contents**, **Actions**, **Issues** and **Pull requests**, plus **Dependabot alerts** and **Code scanning alerts** if you want those sections. Without alert permissions those sections show "not assessed". Even with a broader token, the app only issues GET requests.
- **Anthropic key:** stored in the macOS Keychain (`com.khaneilcampbell.ai-ops-atlas` / `anthropic-api-key`), read by the Rust client at request time, sent only to `api.anthropic.com`, and never returned to the web view, written to files or logged. Errors are reported without the request, which carries the key header.
- **What is sent to Anthropic:** for the selected repository only: metadata, file names in the root, excerpts of the README and a few root manifests (`package.json`, `Cargo.toml`, `pyproject.toml`, ...), recent commit messages, open issue and PR titles, release tags, workflow names and results, and alert summaries. For private repositories the panel says so before you confirm. No other service receives repository content.
- **Prompt injection:** repository text is treated as untrusted. It is sanitized (control characters removed, anything that could close the data fence neutralized), placed inside one fenced block, and the system prompt says that block can't change the task. The model has no tools, so text can't make it act. Its output must match a closed schema (extra fields are rejected), citations must exist in the data, and nothing the model writes can become a verified finding. Tests cover a README that tries to close the fence, claim the repository is secure, and call a tool.

## 6. Scheduling

Scheduled analysis is **off by default**. Turning it on requires an explicit confirmation that records when you agreed. It only runs repositories you've assigned (analyzing a repository assigns it; you can unassign in Settings), never overlaps a running job, waits a full interval after any attempt (so a failing repository isn't retried in a loop), and stops when the monthly budget is used up.

**App-local scheduling vs a persistent worker.** The scheduler runs inside the app and only while it is open; it checks every ten minutes and catches up once on launch if a run is overdue. That fits Atlas today: it's a desktop app you open, the credentials live in your login Keychain, and a quit or crash is handled safely (runs left queued or running are marked interrupted on the next launch, and nothing partial is saved). A persistent worker, such as a `launchd` agent running a small headless binary built from the same `intel` crate, would run while the app is closed. It is the right next step once you want overnight runs, and it needs no redesign because the pipeline, store and scheduler don't depend on the window. It would need its own Keychain access prompt, a lock file so the app and the worker never run the same repository at once, and macOS notifications for results. A hosted worker (GitHub Actions or Cloudflare) would move secrets off your Mac and is not recommended for this phase.

## 7. Configure and run

1. Get an API key at [console.anthropic.com](https://console.anthropic.com/settings/keys). A key in its own workspace with a spend limit caps what Atlas can spend regardless of app settings.
2. In Atlas, open **Settings → Repository intelligence**, paste the key and choose **Save to Keychain**.
3. Optionally adjust the default depth, models, prices, limits, retries and timeout, then **Save**.
4. Open a repository (Repos or the map), scroll to **Repository intelligence**, choose **Analyze repository**, check the depth and worst-case cost, and choose **Send to Claude**.
5. Watch it in **Intel → Activity** (each run has an id and a step-by-step trace) and see spend in **Intel → Costs**.

For private repositories and security alerts, also save a GitHub token (Settings → GitHub access) with the permissions in section 5.

## 8. Tests

`cargo test --manifest-path src-tauri/Cargo.toml` runs the agent tests with scripted GitHub and Anthropic fakes. They never call a real API. Covered:

- GitHub authentication failure, missing or inaccessible repository, GitHub rate limiting, empty repositories, sections GitHub refuses, alerts without a token
- Anthropic errors (400/401/402/404 not retried; 429, 529 and 5xx retried with backoff and then reported), refusals, truncated answers, missing key
- Invalid model responses (non-JSON, wrong enum, missing fields, extra fields), size limits, invented citations
- Duplicate jobs, cancellation while queued and while waiting on Claude, interrupted runs recovered on startup
- Token and cost accounting, including fallback attempts priced by their own model, monthly totals, per-run and monthly limits
- Prompt injection from README text, data fencing, no tools in the request
- Read-only enforcement: every GitHub path is checked against the production allowlist and the selected repository
- Incremental reuse and forced re-analysis, scheduling off by default, consent required, no overlap

`npm test` adds cost rollup and formatting tests for the UI.

## 9. Not done yet

- The scheduler only runs while the app is open (see section 6).
- Only the root of the repository is inspected for manifests; monorepos with manifests in subfolders get a thinner stack picture.
- Secret-scanning alerts are deliberately not read, since they can contain secrets.
- Prices are configured by hand. Anthropic's API reports tokens, not dollars, so costs remain estimates.
- Reports are kept per repository (latest only); older reports are not versioned. Run history keeps the latest 300 runs.
- Not yet exercised against the live Anthropic API from CI, by design. The first real run is yours.

## 10. Roadmap for the next autonomous agent

1. **Persistent worker:** the `launchd` agent described above, sharing the `intel` crate, with a lock file and notifications.
2. **Agent registry in Rust:** move the agent identity, version, config and run store behind a small `Agent` trait so a second agent reuses the queue, budgets, traces and Activity Center unchanged.
3. **Next agent: CI Failure Triage.** When a workflow fails on a default branch, fetch the failing job's logs (read-only), ask Claude for a likely cause and a suggested fix, and show it beside the CI finding. Same guardrails: fenced logs, no tools, schema output, budgets.
4. **Governed actions, later and opt-in:** proposals (for example "open an issue with this text") that wait for an explicit approval in Atlas, with a separate write-scoped token that the read-only agents never get.
5. **Batch analysis:** scheduled runs across many repositories through the Message Batches API at half price when results aren't needed immediately.
