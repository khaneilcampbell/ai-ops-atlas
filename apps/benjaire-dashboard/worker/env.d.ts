// Secrets and local-only settings. Not in wrangler.jsonc; set them with
// `wrangler secret put NAME` (production) or in .dev.vars (local, git-ignored).
interface Env {
  /** Comma-separated emails allowed in, checked again after Access. A secret so no address is committed. */
  ALLOWED_EMAILS?: string;
  /** Local development only: lets `wrangler dev` on localhost skip Access. */
  ALLOW_LOCAL_DEV?: string;
  DEV_EMAIL?: string;
  // Integration credentials (read-only, see worker/sources.ts).
  CF_API_TOKEN?: string;
  CF_ACCOUNT_ID?: string;
  CF_ZONE_ID?: string;
  GITHUB_TOKEN?: string;
  N8N_FEED_SECRET?: string;
  STRIPE_RESTRICTED_KEY?: string;
}
