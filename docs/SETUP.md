# Setup and deployment

Nothing here changes the public website, its Worker or its DNS records. Steps marked **approval** change production systems and wait for the owner's go-ahead.

## 1. Cloudflare Access (owner, about 10 minutes)

1. Cloudflare dashboard → **Zero Trust**. If asked, pick a team name (for example `benjaire`) and the **Free** plan.
2. **Settings → Authentication → Login methods → Add new → Google**. Follow the steps to create the Google OAuth client. Turn on 2-Step Verification on the Google account you'll sign in with.
3. **Access → Applications → Add an application → Self-hosted**.
   - Name: `Benjaire Ops`. Session duration: `24 hours`.
   - Public hostname: `dashboard.benjaire.com` (it can be added before the domain is attached; nothing is reachable until step 5).
   - Login methods: Google only.
4. Add a policy: Action **Allow**, Include **Emails** → your Google address. No other rules.
5. Copy the application's **Audience (AUD) tag** and your **team domain** (`<team>.cloudflareaccess.com`).

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
