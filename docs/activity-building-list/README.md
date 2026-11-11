# Current building list in Activity

Uses the same off-map project set as the city. Removed buildings remain in the catalog and All activity history; stable project and agent IDs are unchanged. The Project filter lists current project buildings, not unconnected visual landmarks.

Agent runs use the owning project name. Repository events use the repository’s primary project when several projects share it; an ambiguous repository is shown by repository name without guessed ownership.

Validation: type checks, lint, build and two desktop/phone browser checks passed. Full suite: 1334 passed; the existing large-map timing guard failed (2251ms vs1500ms) on this busy machine. Focused attribution and scene validation: 17 passed, including the unchanged timing guard in isolation. No guard or baseline changed.

[Before desktop](before/desktop.jpg) · [After desktop](after/desktop.jpg) · [Before phone](before/phone.jpg) · [After phone](after/phone.jpg)

Screenshots use fixtures, not live operational evidence. Local preview may have partial GitHub coverage due to its anonymous rate limit.
