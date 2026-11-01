# Visual checks

Atlas can screenshot its own views in headless Chrome, so a change to the map can be looked
at and compared instead of described. It runs the plain web build (`vite`), not the desktop
app, with sample GitHub data and a frozen clock, so every run draws the same scene.

## The loop

1. Take screenshots of the current views: `npm run visual:shots`. They land in `visual/out/`
   at 2x (3024 x 1800).
2. Change the scene.
3. Take them again and look at them. To compare with a reference image:
   `npm run visual:compare -- reference.png visual/out/map-night.png`. It writes
   `visual/out/compare.png` (reference, screenshot, and a diff in red when the sizes match)
   and prints how many pixels differ.
4. Repeat until it matches the intent, then check nothing else moved: `npm run visual`.

## Commands

| Command | What it does |
| --- | --- |
| `npm run visual` | Screenshots each view and compares it with its baseline. Fails if more than 1% of pixels changed. |
| `npm run visual:update` | Replaces the baselines with new screenshots (one capture each). Use after an intended visual change. |
| `npm run visual:shots` | Screenshots only, into `visual/out/`. No comparison. |
| `npm run visual:compare -- a.png b.png [out.png]` | Side by side plus a pixel diff of any two PNGs. |

Failures leave the expected, actual and diff images in `test-results/`, and an HTML report
in `playwright-report/`.

## Views covered

`map-day`, `map-night`, `map-selected` (AI Ops Atlas selected, inspector open), `office`
(inside AI Ops Atlas HQ), `mission-control`, and `active-agents` (skipped until the
Mission Control Active agents tab is on main). The list is in `visual/views.visual.ts`;
a new view is one more test there.

`visual/header.visual.ts` checks the top bar at 1728, 1512, 1280 and 1024 px and on a phone:
nothing in it may wrap, spill out of the bar or run past its right edge, and each width has a
screenshot (`header-wide`, `header-laptop`, `header-narrow`, `header-small`, `header-phone`).
It adds the pills the Mac app shows (a long live status, "Read-only + re-runs") so the
crowded case is covered in the web build.

`visual/copy.visual.ts` has no screenshots: it checks that text can be selected in every
view (desktop and phone), that the map stage and nav stay unselectable so drags still pan,
and that the inspector's copy button puts the repository name on the clipboard.

## How it works

- **No desktop parts.** In a browser the app already skips Tauri: no Keychain, vault,
  updater or live feed. GitHub is read anonymously, and the tests answer those requests
  from `visual/github.ts` (every catalog repository, green CI, one red run on
  benjaire.com). No token and no network are needed.
- **Same frame every time.** The clock is installed paused at 2026-10-28 15:00 UTC.
  Animation frames run only when a test steps the clock, a fixed number of times, so cars,
  boats and the sky land in the same place. Reduced motion is on, so camera moves jump.
- **Real WebGL.** Chromium runs with SwiftShader (`--use-gl=angle --use-angle=swiftshader`),
  so the 3D map is drawn for real, just slowly (a few seconds a view at 2x). The whole set
  takes about 3 to 4 minutes.
- **Baselines per machine.** Fonts and software rendering differ slightly between
  machines, so local baselines live in `visual/baselines/local/` and the GitHub runner's
  in `visual/baselines/ci/`.

## In CI

`.github/workflows/visual.yml` is a separate, optional job. It runs on pull requests that
touch views, styles, components or `visual/`, and by hand from the Actions tab. It is not
a required check. The specs run as 6 shards in parallel (`--shard=N/6`, split by spec
file, 35 minutes each); one runner could no longer finish all of them in 45 minutes.
Run one shard locally with `npx playwright test -c visual --shard=1/6`. Each shard uploads
its screenshots, diffs and report as a `visual-results-N` artifact. Until `visual/baselines/ci/` exists it only records screenshots.
To set or accept CI baselines, run the workflow by hand with **update** ticked: it pushes
the new PNGs to a `visual-baselines/run-<id>` branch to open a pull request from.

Playwright is a dev dependency only. Nothing under `visual/` is imported by the app, so it
never reaches the desktop bundle or the Pages build.

## Map performance budget

`npm run measure:perf` (spec: `visual/perf.visual.ts`) measures what one 3D map frame costs:
draw calls, triangles, offscreen passes (shadows, night glow), shader programs, textures,
geometry on the GPU, CPU time per frame and JS heap, for desktop day, night, Battery saver
and iPhone width. It also leaves the map and comes back three times and checks that no
WebGL context or GPU resource is left behind. Each result prints as a `PERF {json}` line.
Counts don't depend on how fast the machine's WebGL is, so compare them across branches;
CPU time per frame is only comparable on the same machine.

`PERF_BUDGET=1 npm run measure:perf` also fails when the desktop day frame goes over
`BUDGET` in the spec. Run it on any pull request that adds to the map, and put the before
and after `PERF` lines in the pull request. `PERF_ONLY="desktop day"` runs one case
(about 6 minutes here).

In CI the budget runs in its own workflow, `.github/workflows/perf.yml`, on every pull request,
so it can be a required check. A pull request that touches nothing the map is built from
(only docs, `ops/`, `catalog/`, `src-tauri/`) passes it in seconds without measuring. A measure
above 90% of its budget leaves a warning on the pull request but still passes.

## Circa preview shots

`visual/circa.visual.ts` renders Circa close-ups (LED band, entrance, lobby, deck) into `artifacts/circa/` for review. It has no baselines and is skipped unless asked for:

```sh
CIRCA_SHOTS=1 npx playwright test -c visual visual/circa.visual.ts
```

## Trackpad look-around inside buildings

`visual/interior-trackpad.visual.ts` sends real trackpad wheel events inside five interiors (a half turn, a pinch, an Option-move), checks the camera, and writes PNGs to `visual/out/interior-trackpad/`. It takes about 9 minutes, so it is skipped unless asked for:

```sh
INTERIOR_TRACKPAD=1 npx playwright test -c visual visual/interior-trackpad.visual.ts
```
