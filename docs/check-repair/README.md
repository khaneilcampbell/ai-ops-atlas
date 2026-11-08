# Post-merge visual check repair

Evidence: GitHub Visual checks run 42352325854, merged commit 017f523. Subsequent PR 259 reproduced the same failures. Frontend CI, Rust CI and Map performance passed; this repair addresses browser checks.

## Confirmed causes

1. The old label check still selected removed Atlas Hills. It now covers Marketplace. The shared selection helper also matched Skyline Station for Skyline; it now requires the full title name boundary, case-insensitively.
2. Commuter checks targeted the removed Hills shuttle and twelve passengers. The new loop shares one mounted-renderer journey check covering all five stops, connected passenger paths, no visible jumps, and Traffic pause. It uses Fiber manual advance rather than searching callback source strings.
3. Ten CI references still described the old title, repository count, estate/highway map and office view. Reviewed the expected/actual artifacts from run 42352325854 before replacing only those approved-design references. Pixel tolerances remain unchanged. Header fixture now updates its text node instead of assuming the final child is text.

## Reference review

The current views retain Atlas branding, current catalog counts, the approved square city, perimeter rail, supported airport and preserved office floor navigation. Header remains within its container at every captured width. Day/night and phone selected views remain readable. Screenshots are test fixtures, not live operational evidence.

References replaced: map-day, map-night, map-selected, office, phone-map, phone-map-selected, header-wide, header-laptop, header-narrow, header-small. All other baselines and thresholds remain unchanged. Original expected and actual artifacts remain attached to the source GitHub run.

No production data, agents, schedules, access, publishing or deployment behavior changes.

## Validation

- 990 unit tests passed; two existing skips unchanged.
- Eight focused browser checks passed: five responsive headers, label coverage, office/Skyline floor switching, and a complete mounted-renderer train journey including Traffic pause.
- Lint, type checks, build and diff whitespace checks passed.
- Full Linux screenshot comparison remains for the PR CI; local header captures were inspected without replacing Linux references with Mac rendering.

The movement harness explicitly delivers the real media-query change under its frozen clock, then uses Fiber manual advance with GPU drawing suppressed between observations. App motion gates remain unchanged.
