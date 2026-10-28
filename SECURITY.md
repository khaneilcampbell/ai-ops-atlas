# Security

AI Ops Atlas is a read-only desktop app with two opt-in exceptions, both off by default, only on repositories you enable, after a native confirmation each time, and written to an audit log ([docs/actions.md](docs/actions.md)): it can re-run the failed jobs of a failed GitHub Actions run, with a separate fine-grained token (Actions: write), and it can squash-merge a pull request GitHub reports ready (mergeable, clean, every required check green, no changes requested, not a draft), with one fine-grained token per repository (Pull requests and Contents: write) and a Touch ID check per merge. There is no override for any check. The website and iPhone build cannot write. It never otherwise changes repositories or starts external agents. Its built-in Repository Intelligence Agent only reads GitHub and sends a summary of the selected repository to Anthropic.

## How secrets are handled

- The optional GitHub token is stored in the macOS Keychain (service `com.khaneilcampbell.ai-ops-atlas`). The Rust side attaches it to requests, and it never reaches the web view, the interface or logs.
- The Rust side only sends `GET` requests to `api.github.com`, and only to an allowlist of repository paths (`src-tauri/src/github.rs`).
- The optional Anthropic API key is stored in the Keychain under the same service (account `anthropic-api-key`). The Rust side reads it for each request to `api.anthropic.com`; it is never returned to the web view, written to disk or logged.
- For a repository you choose to analyze, the agent sends Anthropic its metadata, root file names, README and root manifest excerpts, recent commit messages, open issue and PR titles, release tags, workflow results and alert summaries. Nothing else is sent, and no other service receives repository content. See [docs/repository-intelligence.md](docs/repository-intelligence.md#5-security-and-read-only-guarantees).
- Repository content is treated as untrusted: it is fenced and sanitized in the prompt, the model has no tools, and its answer must match a fixed schema. Claude's output is always labeled as unverified.
- The web view runs under a strict Content Security Policy and can only open `https://` links in your browser.

## Reporting a problem

Please report vulnerabilities privately through [GitHub's private vulnerability reporting](https://github.com/khaneilcampbell/ai-ops-atlas/security/advisories/new) rather than in a public issue.
