# Agent workflow output

Select an agent, then **Output** in its map detail panel or registry inspector. GitHub-connected agents list uploaded artifact bundles (name, size, availability/expiry and trusted GitHub file link), plus jobs and expandable step results. Choose among the ten most recent recorded runs; mainline work is preferred by default. Other agents retain their existing recorded evidence and intelligence-report links.

This is read-only metadata, not a live transcript or an invented report. File bodies, archives and raw logs stay on GitHub. Opening a file may require GitHub sign-in. Agents that publish no artifacts correctly show no downloadable files; denied access and unreadable responses are not treated as empty output. Unknown availability is never reported as available.

## Verified workflow behavior

`khaneilcampbell/projects-intelligence-hub/.github/workflows/ci.yml` renders documents on ordinary CI runs but uploads `project-intelligence-hub-documents` only on `workflow_dispatch` with `documents` enabled. Atlas explains this for Documentation Quality Engineer without dispatching that workflow or changing its behavior.

## Usage and platform boundaries

- Fetch only while Output is mounted: two GETs per selected run, one page each (20 artifacts / 30 jobs / 50 displayed steps per job).
- Reuse successful metadata for two minutes; deduplicate concurrent reads. Explicit refresh and failures have a 15-second cooldown. Keep at most twelve runs and three concurrent run reads in memory. No polling, model calls, external dependencies or generated file contents in local storage.
- Existing desktop transport adds its Keychain token outside the web view; hosted transport uses its server token; local preview remains public-only. Private repositories require read-only Actions access. Connection messages follow the current platform.
- Hosted proxy adds only positive numeric run-ID `jobs` and `artifacts` GET endpoints under its existing owner allowlist. Logs, ZIP archives, workflow dispatch, writes and other owners remain refused. Returned URLs are constructed from validated repository/run IDs rather than trusted from response bodies; all names render as text.

## Validation

Full suite: 699 passed, 2 skipped on main `b449bd4` plus this feature. Lint, type checks and build passed. Focused unit tests cover malformed/foreign run URLs, partial permission failures, unreadable responses, expiry, trusted links, bounds, deduplication, TTL/cooldown and concurrency. Browser checks pass for desktop and mobile Output panels, expired files, job steps, repeated openings/refresh reuse, and access errors. Screenshots use deterministic fixtures, not evidence of live generated DOCX files. No visual baselines were changed. Native private-repository downloads still depend on the user's GitHub permissions and sign-in; full archive preview is intentionally not implemented.
