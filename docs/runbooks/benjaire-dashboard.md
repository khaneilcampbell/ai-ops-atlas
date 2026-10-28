# Runbooks: Benjaire Ops Dashboard

Repository: [khaneilcampbell/benjaire-dashboard](https://github.com/khaneilcampbell/benjaire-dashboard) (private). Setup and deployment steps are in its `docs/SETUP.md`.

## Dashboard CI

`.github/workflows/ci.yml`. Runs on every pull request, push to `main` and by hand.

- **What it does:** `npm run ci` (Worker types, unit tests, build, secret scan of `dist`, `worker`, `src` and `migrations`), applies the D1 migrations to a local database, starts the Worker on localhost with a CI-only Access bypass, then runs the axe accessibility and layout tests in light and dark, desktop and phone.
- **Healthy:** latest run on `main` is green.
- **When it fails:** reproduce with `npm ci && npm run ci`. For the accessibility step, run the Worker locally as in the README (`.dev.vars` with `ALLOW_LOCAL_DEV=true`), then `npx playwright install chromium && npm run test:a11y`. If the Worker never answers `/api/me`, read `wrangler.log` in the job output.
- **Stop it:** disable the workflow in Actions.
