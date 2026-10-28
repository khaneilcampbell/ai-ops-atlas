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
| `npm run visual:update` | Replaces the baselines with new screenshots. Use after an intended visual change. |
| `npm run visual:shots` | Screenshots only, into `visual/out/`. No comparison. |
| `npm run visual:compare -- a.png b.png [out.png]` | Side by side plus a pixel diff of any two PNGs. |

Failures leave the expected, actual and diff images in `test-results/`, and an HTML report
in `playwright-report/`.

## Views covered

`map-day`, `map-night`, `map-selected` (AI Ops Atlas selected, inspector open), `office`
(inside AI Ops Atlas HQ), `mission-control`, and `active-agents` (skipped until the
Mission Control Active agents tab is on main). The list is in `visual/views.visual.ts`;
a new view is one more test there.

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
a required check. Every run uploads its screenshots, diffs and report as the
`visual-results` artifact. A view with no CI baseline yet gets one written on its first run.
To accept an intended change in CI, run the workflow by hand with **update** ticked, then
commit the PNGs from the artifact's `visual/baselines/ci/` folder.

Playwright is a dev dependency only. Nothing under `visual/` is imported by the app, so it
never reaches the desktop bundle or the Pages build.
