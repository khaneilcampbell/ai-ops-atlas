# Atlas Stadium: senior engineer build prompt

KC asked for a prompt a senior engineer can follow to build a new stadium on the Atlas map, named
**Atlas Stadium** (2026-11-07). It replaces the current placeholder bowl (`Stadium.tsx`), which is
40 boxes per tier and still carries a comment naming a real venue.

This file is the brief only. No app code changes in the pull request that adds it.

## Where the design comes from

KC shared five reference renders: a large bowl wrapped in tall, curved shell "petals" that twist
around an open oval roof, standing on a raised ring walkway with bridges out to the city, glowing
warmly at dusk and night. Use them only for the **feel**: soft curved shells, a ring concourse,
a glowing seam pattern, a garden setting. They show a real venue. Atlas Stadium must be an
original design: do not copy its outline, petal count, twist, plan, bridge routes, colours,
signage or any lettering. The name on everything is **Atlas Stadium**, nothing else.

---

## Paste-in prompt

```text
You are a senior design engineer on Atlas (khaneilcampbell/ai-ops-atlas), a Tauri Mac app and the
same React app on the web. The map is react-three-fiber in src/views/map3d. Every merge to main
ships to KC's Mac within about 10 minutes, so treat this as a production release. Read CLAUDE.md
and docs/visual-testing.md first and follow them.

GOAL
Replace the placeholder stadium with a new landmark named "Atlas Stadium": an original bowl with a
petal-shell roof, a raised ring concourse with entrances tied into the existing roads, walks and
Stadium Station, warm day and night lighting, and the shared nameplate. One pull request on its own
branch. Do not merge; KC merges or says "merge".

ORIGINALITY (hard rules)
- KC attached reference renders of a real stadium. Use them only for mood: curved shells, a ring
  walkway, glowing seams. Do not reproduce that venue's silhouette, petal count, spiral direction,
  roof opening shape, plan, bridge layout, colours, signage or any text from it.
- No real venue, team, league, sponsor or brand name anywhere: not in code, comments, test names,
  screenshots, the panel, or the changelog. Delete the existing "inspired by MetLife" comment in
  Stadium.tsx.
- The only name is "Atlas Stadium". Station stays "Stadium Station" (out of scope here).

WHAT EXISTS TODAY (read before writing code)
- src/views/map3d/stadiumPlan.ts: planStadium() picks an 8 x 7 bowl (w, d) with a 2-unit margin
  beside GitHub Profile; the lot is 12 x 11. STADIUM_KEY = "service:skyline-stadium". Keep the key
  and the id "skyline-stadium": selection, panel and tests depend on them.
- src/views/map3d/Stadium.tsx: ~250 instanced boxes, emissive night pitch/screens, floodlight heads
  from stadiumFloodPositions() in streetLighting.ts.
- scene.ts line ~717 reserves the lot; financialPlan.ts, neighborhoodLinks.ts, localFreight.ts,
  connections.ts (links 'profile-stadium' and 'stadium-airport'), perimeterRailPlan.ts (Stadium
  Station, LOOP_STATIONS[3], target at the stadium's east side) and the marketplace rail all treat
  the stadium as a w x d obstacle box centred on (x + w/2, z + d/2).
- Map3D.tsx ~170: the hover/pick box (y1 = TERRACE_H + 2.3). Map3D.tsx ~371: the plaque, name
  "Stadium". src/components/DetailPanel.tsx ~156: panel title "Stadium".
- cityScale.ts says the stadium is deliberately NOT scaled because its lot sets the city layout.

1. SCALE AND FOOTPRINT
- Keep the footprint: the bowl, shells and concourse ring fit inside the existing 12 x 11 terrace
  lot, and the closed building (shells + bowl) inside the 8 x 7 box planStadium() returns. Do not
  change w, d, margin or the planner. If the design truly needs more room, stop and ask KC first:
  a bigger lot moves the Financial District, the freight line and the perimeter rail.
- Height: the shell crown sits between 2.8 and 3.6 world units above TERRACE_H. It must stay below
  the Atlas Marketplace roof (6.4) and below every HQ top (headquartersEnvelope), so the city's
  skyline reads towers > mall > stadium. A stadium is a wide, low landmark, not a tower.
- Put every size in one exported table (e.g. STADIUM in a new stadiumGeometry.ts): bowl radii,
  tier heights, shell count, crown height, opening radii, concourse width and height, entrance
  positions. One table makes the next size change a one-line edit.
- Update everything that hard-codes the old size together: the pick box and plaque roof in
  Map3D.tsx, the street-lighting keep-out box in streetLighting.ts (7.8 x 6.8), and the floodlight
  positions if you move or remove the masts. Derive them from the STADIUM table, not new literals.

2. PETAL ROOF (original geometry)
- Build the shells from your own parametric geometry, not a model file and not a traced outline.
  Suggested approach (change it if you have a better original idea):
  - An elliptical plan matching the 8 x 7 box, so the shells follow the bowl rather than a circle.
  - N shells, an odd number between 7 and 11, chosen by you. Each is a curved lobe swept from the
    concourse rim up and inward to an oval roof opening over the pitch, with a modest lean
    (no more than about 20 degrees of twist end to end). Alternate two crown heights or two
    widths so the rhythm is Atlas's own.
  - Each lobe overlaps its neighbour and leaves a thin vertical seam. Seams are where the light
    shows at night.
  - The opening is offset or shaped so the pitch stays visible from the default overview camera
    (today's low bowl was kept low for exactly that reason; check the overview shot).
- Generate shells as BufferGeometry in a plain .ts module (like atlasHqGeometry.ts or
  githubTowerGeometry.ts), merge all shells into one mesh with mergeGeometries, and all seam strips
  into a second mesh. Correct normals, no coplanar faces (see docs/map-zoom-stability.md), no
  z-fighting where shells overlap.
- Materials: a warm off-white shell with a subtle perforated or banded look from the existing
  shared materials (m.plain / tokens); no new textures, images or network assets.
- Inside the bowl: two or three seating tiers as one merged ring mesh each (not 40 boxes per tier),
  a pitch, two scoreboards. Keep it legible, not detailed: it is seen from far away.

3. RING CONCOURSE AND ENTRANCES
- A raised ring concourse around the bowl at roughly concourse height (about 0.5 above the
  terrace), on slim columns, inside the 12 x 11 lot. One merged mesh for the deck, one instanced
  set for columns.
- Entrances: one main entrance on the east side where the 'profile-stadium' road and walk already
  arrive (planStadium's entry at x + w - 0.1, z + d/2), and secondary entrances where the
  'stadium-airport' walk and the Stadium Station boarding path (stationBoardingPath() /
  RailStop.walk) reach the lot. Each entrance is a ramp or stair from street level to the deck.
- Use the existing networks; do not draw new roads. Roads follow the one road standard
  (transportScale.ts ROAD, junctions.ts); if a link's last segment needs to end at a new gate,
  change the end point in connections.ts and let routeAround()/pathClear() route it. Walk paths
  must meet a gate, not a wall.
- Tests must prove it: every stadium link's last road point and walk point lies within a small
  distance of a concourse gate, and no road, walk, freight or rail segment crosses the shells or
  the concourse (reuse pathClear and the existing obstacle boxes).

4. DAY AND NIGHT LIGHTING
- Day: shells read bright and soft; seams slightly darker. Night: seams and the shell underside
  glow warm (emissive only), the pitch glows under the floodlit opening, scoreboards glow, the
  concourse edge shows a thin lit line. Lights follow the existing night switch (the `night`
  prop and lightMode) and its easing.
- No real-time lights (no point/spot/rect/directional lights), no useFrame, no animation loop.
  Emissive materials only, created once with useMemo and disposed on unmount (copy the pattern in
  today's Stadium.tsx).
- Keep the night look calm: no bloom spikes, no colour change cycles. Compare with
  visual/night-lights.visual.ts 'stadium' view.

5. NAMEPLATE AND PANEL
- Plaque: keep using the shared plaque({...}) helper in Map3D.tsx (plaques.tsx, PLAQUE spec). Name
  "Atlas Stadium" (13 chars, under the 22-char / 168px limit), roof = the new crown height plus
  PLAQUE.roofGap, priority 2, mark PLANNED (it is still a planned venue), title
  "Atlas Stadium · Planned venue". No hand-built label, no custom width or colour.
- Detail panel title "Atlas Stadium"; leave the eyebrow and chip as they are.
- Rename only display text. Keep ids and keys. If docs/building-names.md (PR #257) has merged,
  match its table; it already maps Stadium -> Atlas Stadium.
- Update visual specs that select the stadium by its old name.

6. PERFORMANCE (the map is close to its budget)
- The map runs near its geometry budget (visual/perf.visual.ts BUDGET: 800 draws, 1.2M triangles,
  80 programs, 8 MB geometry; geometry was already above 90% in November). Atlas Stadium must be
  about net-neutral against the bowl it replaces.
- Targets: at most 10 draw calls for the whole stadium, under 20,000 triangles, no new shader
  programs beyond one or two emissive materials, no lights, no useFrame.
- Export a stadiumPieceCount() and stadiumTriangles() like hqPieceCount() in atlasHqPlan.ts
  and hqTriangles() in atlasHqGeometry.ts, and assert them in a test, plus a source check that Stadium.tsx has no
  <*Light> and no useFrame (copy atlasHq.test.ts).
- Run `npm run measure:perf` before and after, on the same machine, and put both PERF lines in
  the PR. If any budget share goes up by more than 1 percentage point, reduce shell segments first.

7. TESTS
- stadium.test.ts: keep the three placement tests passing unchanged.
- New tests: footprint inside 8 x 7 (shells) and 12 x 11 (concourse); crown height inside the
  2.8 to 3.6 range and below the mall and every HQ top; shell count odd and between 7 and 11;
  gates meet every stadium road and walk link and Stadium Station's walk; no transport crosses the
  stadium; piece and triangle budgets; plaque name and roof match the STADIUM table.
- Run the whole suite: perimeter rail, financial, freight, neighborhood links, street lighting,
  junctions and transport tests all read the stadium box.

8. CHECKS BEFORE ASKING KC TO MERGE
- npm run lint, npm run typecheck, npm test (all green).
- npm run measure:perf before/after (numbers in the PR), and the "Map performance budget" check
  green on the PR.
- Screenshots with a new visual/atlas-stadium.visual.ts (SHOT_DIR only, no baseline), before on
  main and after on the branch, at 2x:
  desktop 1512 wide: overview day, overview night, close three-quarter day, close night,
  concourse with Stadium Station day, selected with panel open;
  iPhone 390 wide: overview day and night, selected.
  Put them in the PR as before/after pairs. Camera positions: start from the 'stadium' view in
  visual/night-lights.visual.ts and the Stadium Station shots in docs/perimeter-rail/.
- npm run visual; if map baselines change on purpose, say so and refresh them (local via
  npm run visual:update, CI via the visual workflow's update run) as described in
  docs/visual-testing.md.
- No Rust or Tauri changes are expected. If any happen, run CI by hand with "Also build the macOS
  app" first.

9. PULL REQUEST
- Fill in .github/pull_request_template.md. Risk: low to medium (map only; no signing, secrets,
  updater or write actions).
- CHANGELOG.md top line, written for KC, e.g.
  "- YYYY-MM-DD · The stadium is now Atlas Stadium: a new petal-roof bowl with a ring walkway to
  the roads and Stadium Station, glowing warm at night (#PR)".
- Rollback: revert the PR; the revert ships as a newer build and Macs update back within about
  10 minutes.
- Do not merge. Post the PR link with the before/after screenshots and the perf numbers.

STOP AND ASK KC IF
- the design needs a bigger lot or any road to move,
- the perf budget share rises by more than 1 point after trimming,
- you are unsure whether a shape is too close to the reference venue.
```

---

## Notes for the reviewer

- Why keep the 8 x 7 box: the stadium lot drives the Financial District placement, the freight
  line, the neighbourhood links and the perimeter rail's Stadium Station (see `cityScale.ts`).
  Growing it is a layout change, which needs KC's OK on its own.
- Why so strict on performance: the November grade measured the map's geometry at 94 to 98% of
  budget, so a heavy landmark would push it over.
- Station name: "Stadium Station" stays for now. Renaming it to "Atlas Stadium Station" (21
  characters, fits the plaque) is a separate small change if KC wants it.
