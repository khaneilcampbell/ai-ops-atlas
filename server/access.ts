// Verifies the Cloudflare Access token that Access adds to every request it lets through.
// Access already blocks anyone who hasn't signed in; checking the token here as well means
// the GitHub proxy stays closed even if the Access policy is removed or misconfigured.

export interface AccessEnv {
  /** e.g. https://your-team.cloudflareaccess.com */
  ACCESS_TEAM_DOMAIN?: string;
  /** The Application Audience (AUD) tag from the Access application. */
  ACCESS_AUD?: string;
  /** Optional comma-separated allowlist, checked on top of the Access policy. */
  ALLOWED_EMAILS?: string;
}

interface Jwk extends JsonWebKey {
  kid?: string;
}

export type CertFetcher = (url: string) => Promise<{ keys: Jwk[] }>;

const b64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));
const json = (s: string) => JSON.parse(new TextDecoder().decode(b64url(s)));

const defaultFetcher: CertFetcher = async (url) => {
  const r = await fetch(url, { cf: { cacheTtl: 3600 } } as RequestInit);
  if (!r.ok) throw new Error(`certs ${r.status}`);
  return r.json();
};

export type AccessResult = { ok: true; email: string | null } | { ok: false; status: number; reason: string };

export async function verifyAccess(token: string | null, env: AccessEnv, now = Date.now(), certs: CertFetcher = defaultFetcher): Promise<AccessResult> {
  const team = env.ACCESS_TEAM_DOMAIN?.replace(/\/+$/, "");
  if (!team || !env.ACCESS_AUD) return { ok: false, status: 503, reason: "Cloudflare Access is not configured for this site." };
  if (!token) return { ok: false, status: 401, reason: "Sign in through Cloudflare Access." };

  const parts = token.split(".");
  if (parts.length !== 3) return { ok: false, status: 401, reason: "Malformed access token." };
  let header: { alg?: string; kid?: string };
  let claims: { aud?: string | string[]; exp?: number; nbf?: number; iss?: string; email?: string };
  try {
    header = json(parts[0]);
    claims = json(parts[1]);
  } catch {
    return { ok: false, status: 401, reason: "Malformed access token." };
  }
  if (header.alg !== "RS256") return { ok: false, status: 401, reason: "Unexpected token algorithm." };

  const { keys } = await certs(`${team}/cdn-cgi/access/certs`);
  const jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk) return { ok: false, status: 401, reason: "Unknown signing key." };
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const valid = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b64url(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
  if (!valid) return { ok: false, status: 401, reason: "Invalid token signature." };

  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!aud.includes(env.ACCESS_AUD)) return { ok: false, status: 403, reason: "Token is for a different application." };
  if (claims.iss !== team) return { ok: false, status: 403, reason: "Token is from a different team." };
  const secs = now / 1000;
  if (!claims.exp || claims.exp < secs) return { ok: false, status: 401, reason: "Session expired. Reload to sign in again." };
  if (claims.nbf && claims.nbf > secs + 60) return { ok: false, status: 401, reason: "Token not valid yet." };

  const email = claims.email?.toLowerCase() ?? null;
  const allowed = (env.ALLOWED_EMAILS ?? "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
  if (allowed.length && (!email || !allowed.includes(email))) return { ok: false, status: 403, reason: "This account isn't allowed." };
  return { ok: true, email };
}
