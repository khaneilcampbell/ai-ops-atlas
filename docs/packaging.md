# Packaging and distribution readiness

Reviewed 2026-11-16 for Production Phase 6. This records what is configured and verified, and what a release to anyone other than the current owner would still need. Nothing here was published or deployed.

## Desktop (Tauri, macOS)

| Item | State | Where |
| --- | --- | --- |
| App metadata | Product name Atlas, id `com.khaneilcampbell.ai-ops-atlas`, category DeveloperTool, macOS 12+ | `src-tauri/tauri.conf.json` |
| Bundle targets | `.app` and `.dmg` | same |
| Production assets | Built by `npm run build` into `dist/`, loaded from `frontendDist: ../dist` | same |
| Content Security Policy | `default-src 'self'`, no remote script or connect sources; network goes through Rust | same, guarded by `src/product/product.test.ts` |
| Platform permissions | Core, open `https://` and `mailto:` links, updater, restart, notifications. No file system, shell or camera access | `src-tauri/capabilities/default.json` |
| Runtime secrets | Not bundled. GitHub, Anthropic, sync and manage-agents keys are entered at runtime and kept in the Keychain behind Touch ID | `src-tauri/src/secrets.rs` |
| Updates | Tauri updater, minisign public key in the config, feed `main-build/latest.json`. Never change the public key: installed copies would stop updating | `tauri.conf.json`, `.github/workflows/release.yml` |
| Code signing | **Self-signed** certificate made by `scripts/macos-signing-cert.sh`, applied in CI on pushes to main from the `macos-signing` environment | `docs/ci-signing-security.md` |
| Notarization | **Not configured.** No Apple Developer ID and no notarization step | — |

What a customer release would need (not done, needs Khaneil's decision and an Apple account):

1. An Apple Developer Program membership and a **Developer ID Application** certificate (secret: `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`).
2. Notarization credentials (`APPLE_ID`, `APPLE_PASSWORD` as an app-specific password, `APPLE_TEAM_ID`, or an App Store Connect API key), stored only in the `macos-signing` environment.
3. A notarize-and-staple step after signing, then a check with `spctl --assess --type execute`.
4. A customer bundle identifier and update feed, so customer copies don't follow the owner's rolling `main-build` release.

Builds not run in this review: the macOS bundle (the cloud container has no macOS toolchain). Rust and Tauri changes are proven by the CI workflow's "Also build the macOS app" option. Phase 6 made no Rust or Tauri config changes.

## Web (Cloudflare Pages)

| Item | State | Where |
| --- | --- | --- |
| Build | `npm run build:web` sets `VITE_ATLAS_WEB=1`; output `dist/` | `package.json` |
| Routing | Single page; views are app state, not URL paths, so no rewrite rules are needed. API under `/api/*` (Pages Functions) | `functions/` |
| Asset paths | Vite default base `/`, hashed file names | `vite.config.ts` |
| API configuration | Same-origin `/api/*` only; the page has no API keys | `functions/_middleware.ts`, `server/` |
| Sign-in | Cloudflare Access on every request plus `ALLOWED_EMAILS`; cross-site writes refused | `server/access.ts`, `server/origin.ts` |
| Security headers | Strict CSP, `frame-ancestors 'none'`, `X-Frame-Options: DENY`, `nosniff`, `no-referrer`, permissions policy, `noindex`; `/api/*` is `no-store` | `public/_headers` |
| Secrets | Cloudflare Pages secrets (list in `docs/production-readiness.md`); `/api/health` reports only whether each is set | `server/health.ts` |
| Environment separation | Pages keeps Production and Preview variables separately. Preview deployments should get no production secrets, or their own test keys | Cloudflare dashboard |

What a customer deployment would need: its own Pages project, Access application and D1 database, its own secrets, and its own n8n instance and Step Runner keys. Atlas has one owner per deployment today; it is not multi-tenant.

## Commercial readiness

Not claimed. The product experience (setup, workspaces, integrations, templates, agent catalog) works for one owner per install. Missing for selling it: notarized builds, a customer update channel, per-customer deployment automation, server-side storage of workspace settings (they're device-only), a public agent catalog with code review of third-party agents, billing, and support processes.
