# Setup and deployment

Nothing here changes the public website, its Worker or its DNS records. Steps marked **approval** change production systems and wait for the owner's go-ahead.

## 1. Cloudflare Access with Google sign-in (owner, about 15 minutes)

You need two browser tabs: the Cloudflare dashboard and the Google Cloud Console, both signed in with your own accounts.

**A. Find your team name (Cloudflare)**
1. Cloudflare dashboard → **Zero Trust**. If this is your first visit, choose a team name (for example `benjaire`) and the **Free** plan.
2. **Settings → Team name and domain**. Note the team domain, `<team>.cloudflareaccess.com`.

**B. Create the Google OAuth client (Google Cloud Console, console.cloud.google.com)**
1. Create a project, for example `Benjaire Ops`.
2. **APIs & Services → OAuth consent screen → Get started**. App name `Benjaire Ops`, support email: your address. Audience: **External**. Contact email: your address. Agree and **Create**.
3. **Audience → Test users → Add users**: add your own Google address. In Testing mode only listed addresses can sign in, which is what we want.
4. **Clients → Create client**. Application type **Web application**, name `Cloudflare Access`.
   - Authorized JavaScript origins: `https://<team>.cloudflareaccess.com`
   - Authorized redirect URIs: `https://<team>.cloudflareaccess.com/cdn-cgi/access/callback`
5. **Create**, then copy the **Client ID** and **Client secret**. Treat the secret like a password: paste it only into Cloudflare, never into chat or a file.

**C. Add Google as a login method (Cloudflare)**
1. **Zero Trust → Integrations → Identity providers → Add new identity provider → Google**.
2. Paste the Client ID (shown as **App ID**) and Client secret. Turn on **PKCE**. **Save**.
3. Select **Test** next to Google and sign in. A success page means it works.
4. Turn on 2-Step Verification on that Google account if it isn't on already.

**D. Protect the dashboard (Cloudflare)**
1. **Zero Trust → Access controls → Applications → Create new application → Self-hosted and private**.
2. Name `Benjaire Ops`. Add public hostname `dashboard.benjaire.com`. Session duration `24 hours`.
3. Login methods: **Google** only (turn off the others, and turn on **Instant Auth** so it skips the chooser).
4. Policy: name `Owner only`, Action **Allow**, Include → **Emails** → your Google address. Nothing else.
5. **Save**. Open the application again and copy the **Application Audience (AUD) Tag**.

Send Claude two things, neither of them secret: the team domain and the AUD tag. Your email address goes in as a Worker secret in step 3; it is never committed.

## 2. D1 database (approval: creates a new database, touches nothing existing)

```bash
npx wrangler d1 create benjaire-dashboard
# paste the printed database_id into wrangler.jsonc
npx wrangler d1 migrations apply benjaire-dashboard --remote
```

## 3. Settings and secrets

In `wrangler.jsonc`, set `ACCESS_TEAM_DOMAIN` and `ACCESS_AUD` (neither is secret). Then:

```bash
npx wrangler secret put ALLOWED_EMAILS     # your Google address; comma separated for more than one
```

Integration credentials go in as they're connected, one step at a time. The Connections page shows which are missing and the exact permissions:

| Secret / var | Create it at | Permissions |
|---|---|---|
| `CF_API_TOKEN` (+ `CF_ACCOUNT_ID`, `CF_ZONE_ID`) | Cloudflare → My Profile → API Tokens → Create custom token | Account Analytics Read, Workers Scripts Read, Workers Builds Read; Zone `benjaire.com`: Analytics Read, DNS Read. Set a 12-month expiry. |
| `GITHUB_TOKEN` | GitHub → Settings → Developer settings → Fine-grained tokens | Only `khancam15/benjaire.com`: Contents, Pull requests, Actions, Metadata, all Read. |
| `STRIPE_RESTRICTED_KEY` | Stripe → Developers → API keys → Create restricted key | Read on Balance, Charges, Refunds, Checkout Sessions, Products, Prices, Payment Links. Nothing else. |
| `N8N_FEED_SECRET` | Generate: `openssl rand -hex 32` | Shared with the n8n Ops feed workflow (approval). |

Never paste these into chat, commits or issues.

## 4. Deploy the Worker (approval)

`wrangler.jsonc` keeps `workers_dev` and `preview_urls` off, so a deploy creates no public URL. With no route or domain the Worker can't be reached by anyone yet.

```bash
npm ci && npm run ci
npx wrangler deploy
```

Optionally connect the repo in **Workers & Pages → benjaire-dashboard → Settings → Builds** (build `npm run build`, deploy `npx wrangler deploy`, previews off).

## 5. Attach the domain (approval: DNS)

**Workers & Pages → benjaire-dashboard → Settings → Domains & Routes → Add → Custom domain → `dashboard.benjaire.com`.** Cloudflare adds one DNS record for that subdomain only; `benjaire.com`, `www` and email records are untouched.

Verify:

| Check | Expected |
|---|---|
| Open `https://dashboard.benjaire.com` in a private window | Cloudflare Access login, not the dashboard |
| Sign in with an address not on the list | Access denies |
| Sign in with your Google account | Overview loads; your email is shown top right |
| `curl -i https://dashboard.benjaire.com/api/me` | `302` to Access login (Access) or `401` (Worker) |
| Response headers | `content-security-policy`, `strict-transport-security`, `x-frame-options: DENY`, `x-robots-tag: noindex` |

## Rollback

Remove the custom domain (step 5). The dashboard is unreachable again; the website is unaffected. D1 has Time Travel: `npx wrangler d1 time-travel restore benjaire-dashboard --timestamp <ISO time>` restores the database to any point in the last 30 days.

## Operating

- **Token expiry:** each credential's expiry date goes on your calendar with a two-week reminder. Rotating one means `wrangler secret put` with the new value; nothing else changes.
- **Logs:** Workers & Pages → benjaire-dashboard → Observability. Logs record route, status and denial reasons, never request bodies or credentials.
- **Cost:** Workers Free, D1 Free and Access Free cover this. The only usage that counts against a paid quota is the n8n feed's executions (about 720 a month at hourly).
