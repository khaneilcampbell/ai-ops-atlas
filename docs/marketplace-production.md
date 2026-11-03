# Marketplace product workspaces

Prepared on `codex/marketplace-production` from main `629a285`. Not merged or deployed.

## Confirmed defects and repairs

1. Basement car park and exterior ramp remained in a four-floor client workspace. Removed the basement destination, parked-car geometry and map-side ramp. Existing floor IDs 0–3 and unit IDs remain unchanged.
2. Single-floor Lobby omitted the central courtyard paving. It now uses the same ground paving as the combined view. Ray tests confirm all four ribbon slabs have upward-facing solid surfaces; no duplicate or double-sided floor workaround was added.
3. Upper rooms inherited fixed furniture sizes and a one-segment doorway. Interior radii grow from 11×9 to 16×13; the exterior parcel envelope remains the original 12.4×11.6. Interior floor spacing is planned separately from the stepped map exterior. Doors span three facade bays. Six production rooms have compact desks beside their entrances. Floor switches explicitly wake rendering for one bounded second; static interiors otherwise request no idle frames.

## Planned workspace links

These are links to existing Commerce workers, not duplicate registry agents or changes to their runtime/workplace ownership. Selecting a production room exposes the existing AgentOutput component and its genuine recorded evidence. Figures are static representations, not proof of execution.

| Floor / room | Responsibility | Existing worker ID |
|---|---|---|
| 1 / L1-U1 | Production coordination | commerce-loop |
| 1 / L1-U2 | Product research | market-analyst |
| 1 / L1-U3 | Product design | brand-strategist |
| 1 / L1-U4 | Brand copy and SEO | copy-strategist |
| 1 / L1-U5 | Visual production | canva-mockups |
| 1 / L1-U6 | Quality and release review | commerce-tests |

All assignments are **Planned · Not connected**. Their owning project remains `commerce-pipeline`; actual execution source is displayed in the workspace inspector. No new agent is registered or activated. Output uses existing cached Atlas evidence and cannot initiate a run.

## Benjaire conventions and approval boundary

Read `khaneilcampbell/benjaire.com` README during this work. Benjaire has Digital Solutions and Consumer Brands pillars; Flow checkout and delivery operate outside its website repository. Draft deliverables here are product briefs, design handoffs, copy/metadata and review evidence. No customer records, unreleased brands, sold Flow product files, n8n workflow exports or credentials are introduced into this public repository. Approval is required before publishing or sending anything.

No model calls or schedules were added. A future $1 monthly agent budget is **not implemented or enforced** by these workspace links. Building lighting does not imply active business operations.

## Lighting and circulation

Night view uses two non-shadow-casting lights per visible floor, warm fixture strips and the existing exterior window glow. No per-room shadow maps or lighting animations. A static prepared lift and rear landing complement the existing escalators; no passenger, elevator or door-traversal simulation was added. Room doors are visibly open in the cutaway. Lift doors remain static.

## Validation

- 28 focused tests: map lot/roads and all grouping modes, garden clearance, stable floors/units, existing worker IDs, production doorway dimensions, lift/escalator separation and upward-facing ground slabs.
- Type check, full lint and production build pass. Existing large-chunk and Tauri import warnings remain.
- Two Playwright checks cover day/night, Lobby, all floors, production rooms, Output and keyboard floor selection. Screenshots are captured from fixture data; their header CI state does not report production health.
- Visual baselines were not changed.

Remaining: workspace assignments do not execute a product pipeline; elevator travel and occupant movement are not implemented. Upper event/dining floors retain schematic furniture and are not certified architectural/accessibility plans. Existing city-through-window scenery and map interactions remain shared components.

Rollback: revert the Marketplace-specific change set. No data migration, external configuration or production rollback is required.
