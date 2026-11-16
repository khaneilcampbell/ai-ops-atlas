# Tool facilities

Smaller buildings beside each project building for the tools and integrations its agents and
automations really use (Khaneil, 2026-11-16). Hierarchy: district → project building → tool
facility → tool or Integration Center entry.

## Where things live

| What | File |
| --- | --- |
| Which facilities exist, and their status rules | `src/catalog/toolFacilities.ts` |
| Where satellites stand (deterministic placement) | `src/views/map3d/toolFacilityPlan.ts` |
| How they are drawn (reuses the tool office parts) | `src/views/map3d/ToolFacilities.tsx` |
| Inspector panel and the building's facility list | `src/components/ToolFacilityPanel.tsx` |
| Map inventory rows (`Tool facility`) and unplaced notes | `src/inventory/mapInventory.ts` |

## Rules

- **Only real tools.** A facility exists when a current (not retired) item names the tool in
  `registry.responsibilities.tools`, or for n8n links an n8n workflow. "Claude Code" is a coding
  tool someone runs, not Atlas's Claude integration, so it doesn't count.
- **Two kinds.** The district tool offices the layout already draws (Payments Office, Automation
  Works…) count as facilities and keep their place and key. Integrations no office covers yet
  (GitHub → Repository Office, Claude → AI Model Lab, and n8n, Cloudflare or Stripe where a building
  has no office for them) become satellites.
- **Size.** Half the parent's width, depth and height (`FACILITY_SCALE`). Where that doesn't fit,
  the footprint shrinks in steps to 60%; below that the facility stays unplaced with a reason, shown
  in the building's inspector and in the map inventory's notes.
- **Placement.** Only on the parent district's own terrace, off every tower plaza (entrances and
  plaza lanes included), paving, street, footpath, the railway, houses, fountains and other
  buildings. Nearest free spot to the parent wins; ties break by position. No randomness and
  nothing stored: the same city always gives the same spots. Nothing already on the map moves.
- **Status.** From the Integration Center only. Green needs a real successful check; a key that is
  set but unchecked stays grey ("Configured · not verified"); amber for degraded; red for
  disconnected. A tool with no Integration Center entry is "Unknown". Nothing animates.
- **Toggle.** The map toolbar's Tool facilities button (`atlas:mapFacilities`), off by default so
  the default map, its baselines and its frame cost stay unchanged. The status probe runs only
  while it is on.

## Adding a tool

Name it in the agent's `registry.responsibilities.tools`. If Atlas has an Integration Center entry
for it, add a rule to `SATELLITE_RULES` (map name never a vendor's brand) and a look in
`toolBrand.ts`. Tests: `src/catalog/toolFacilities.test.ts`, `src/views/map3d/toolFacilityPlan.test.ts`.
Screenshots: `SHOT_DIR=… npx playwright test -c visual visual/tool-facilities.visual.ts`.
