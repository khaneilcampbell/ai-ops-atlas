# Compact Website management

Presentation-only, opt-in `compact` mode on PropertyDashboard. Only Mission Control enables it. Other insight cards retain their dimensions.

- Card padding: 12/14 → 8/10 px; metric gaps: 10 → 7 px. Cards grow with content, with no fixed heights or line clamps.
- Three metrics per row, two on phones. Sites share a row above 1200 px and stack below it.
- Each unchecked metric says “Not checked”; one per-site notice explains missing checks.
- Check age stays visible. Full source notes and diagnostics are keyboard-accessible under “Sources and check details.” Incidents, actions and source links remain available.
- Cached data after a failed refresh has a visible saved-results notice. No collection, status computation, refresh timing, credentials or integrations changed.

Run `npm run visual -- --config visual/website-compact.config.ts` for six desktop/narrow/phone checks with unavailable sources and long diagnostics. Includes failed-refresh retention, overflow and keyboard expansion checks. Fixtures are synthetic. `visual/website-card-sizes.json` records the original first-row heights used for the reduction regression check; no existing visual baselines were changed.

Screenshots are before/after at desktop and phone widths, plus a narrow-desktop incident view. The phone screenshots show the first site's viewport; the second remains reachable by scrolling.
