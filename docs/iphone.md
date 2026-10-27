# Atlas on iPhone (hosted web build)

The same React app runs as a private web page on Cloudflare Pages, so you can open it in
Safari and add it to the Home Screen. It stays read-only.

## How it fits together

```
iPhone Safari ──► Cloudflare Access (email one-time code)
                     │ signed-in only
                     ▼
              Cloudflare Pages: static app (dist/)
                     │ fetch /api/github/...
                     ▼
              Pages Function (functions/) ── verifies the Access token again
                     │ adds GITHUB_TOKEN (Cloudflare secret, never sent to the browser)
                     ▼
                 api.github.com (GET only, allowlisted paths, your repos only)
```

- `VITE_ATLAS_WEB=1` (`npm run build:web`) makes the app read GitHub through `/api/github`.
- `functions/_middleware.ts` refuses every `/api/*` request without a valid Cloudflare Access
  token for this app (signature, audience, issuer and expiry are checked). If Access isn't
  configured it fails closed with 503.
- `server/github.ts` only forwards the GET paths the app uses (`/repos/<owner>/<repo>`, its
  `languages`, `commits`, `actions/runs`, `actions/workflows/<id>/runs`, `/users/<owner>/repos`,
  `/user/repos`) for owners in `ALLOWED_OWNERS`. Anything else gets 403 without calling GitHub.
- Desktop-only features (Keychain token, repository intelligence runs) show an "available in
  the desktop app" state in the browser.

## One-time setup (Cloudflare dashboard)

1. **GitHub token.** Create a fine-grained token, resource owner `khaneilcampbell`, all
   repositories, read-only `Contents`, `Metadata` and `Actions`. Nothing else.
2. **Pages project.** Workers & Pages → Create → Pages → connect `khaneilcampbell/ai-ops-atlas`.
   Production branch `main`, build command `npm run build:web`, output directory `dist`.
3. **Access application.** Zero Trust → Access → Applications → Self-hosted. Domain: the Pages
   domain (e.g. `atlas-xxxx.pages.dev`, and `*.atlas-xxxx.pages.dev` for previews). Policy:
   Allow, Include → Emails → your address. Login method: One-time PIN. Copy the
   **Application Audience (AUD) tag**.
4. **Variables** (Pages project → Settings → Variables and secrets, Production and Preview):
   - `GITHUB_TOKEN` (secret): the token from step 1
   - `ACCESS_TEAM_DOMAIN`: `https://<your-team>.cloudflareaccess.com`
   - `ACCESS_AUD`: the AUD tag from step 3
   - `ALLOWED_EMAILS` (optional): your email, checked on top of the Access policy
   - `ALLOWED_OWNERS` (optional): defaults to `khaneilcampbell`
5. Redeploy, open the URL on the iPhone, sign in with the emailed code, then
   Share → **Add to Home Screen**.

## Phone layout

`src/styles/mobile.css` applies under 760px wide (or a phone on its side): the sidebar becomes
a bottom tab bar, the inspector and detail panels become bottom sheets, the map takes one-finger
pan and two-finger pinch zoom, and inputs are 16px so Safari doesn't zoom on focus.
