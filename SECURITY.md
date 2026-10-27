# Security

AI Ops Atlas is a read-only desktop app. It never changes repositories or starts agents.

## How secrets are handled

- The optional GitHub token is stored in the macOS Keychain (service `com.khaneilcampbell.ai-ops-atlas`). The Rust side attaches it to requests, and it never reaches the web view, the interface or logs.
- The Rust side only sends `GET` requests to `api.github.com`, and only to an allowlist of repository paths (`src-tauri/src/github.rs`).
- The web view runs under a strict Content Security Policy and can only open `https://` links in your browser.

## Reporting a problem

Please report vulnerabilities privately through [GitHub's private vulnerability reporting](https://github.com/khaneilcampbell/ai-ops-atlas/security/advisories/new) rather than in a public issue.
