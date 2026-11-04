// Cloudflare Access JWT verification (ADR-0005 §1).
// Access sits in front of the dashboard and signs every request it lets
// through. We verify that signature again here so a missing or misconfigured
// Access policy fails closed instead of exposing the dashboard.
// Pure apart from the injected JWKS fetcher, so it can be unit-tested.

export interface AccessConfig {
  /** Zero Trust team domain, e.g. "benjaire.cloudflareaccess.com". */
  teamDomain: string;
  /** Application Audience (AUD) tag. */
  aud: string;
  /** Emails allowed in. Access already enforces this; we check it twice. */
  allowedEmails: string[];
}

export interface Identity {
  email: string;
}

export type AuthResult = { ok: true; identity: Identity } | { ok: false; reason: string };

interface Jwk extends JsonWebKey {
  kid?: string;
}
export type JwksFetcher = (url: string) => Promise<{ keys: Jwk[] }>;

const CLOCK_SKEW_S = 60;

function b64urlToBytes(input: string): Uint8Array<ArrayBuffer> {
  const b64 = input.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(input.length / 4) * 4, '=');
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function decodeJson(part: string): Record<string, unknown> {
  return JSON.parse(new TextDecoder().decode(b64urlToBytes(part))) as Record<string, unknown>;
}

export function parseConfig(env: { ACCESS_TEAM_DOMAIN?: string; ACCESS_AUD?: string; ALLOWED_EMAILS?: string }): AccessConfig | null {
  const teamDomain = (env.ACCESS_TEAM_DOMAIN ?? '').trim().replace(/^https?:\/\//, '').replace(/\/+$/, '');
  const aud = (env.ACCESS_AUD ?? '').trim();
  const allowedEmails = (env.ALLOWED_EMAILS ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  if (!teamDomain || !aud || allowedEmails.length === 0) return null;
  return { teamDomain, aud, allowedEmails };
}

/** Token from the Access header, or from the CF_Authorization cookie. */
export function tokenFrom(req: Request): string | null {
  const header = req.headers.get('Cf-Access-Jwt-Assertion');
  if (header) return header.trim();
  const cookie = req.headers.get('Cookie') ?? '';
  const match = cookie.match(/(?:^|;\s*)CF_Authorization=([^;]+)/);
  return match ? match[1] : null;
}

export async function verifyAccessJwt(
  token: string | null,
  config: AccessConfig | null,
  fetchJwks: JwksFetcher,
  nowS: number = Math.floor(Date.now() / 1000),
): Promise<AuthResult> {
  if (!config) return { ok: false, reason: 'access-not-configured' };
  if (!token) return { ok: false, reason: 'missing-token' };

  const parts = token.split('.');
  if (parts.length !== 3) return { ok: false, reason: 'malformed-token' };

  let header: Record<string, unknown>;
  let claims: Record<string, unknown>;
  try {
    header = decodeJson(parts[0]);
    claims = decodeJson(parts[1]);
  } catch {
    return { ok: false, reason: 'malformed-token' };
  }
  if (header.alg !== 'RS256') return { ok: false, reason: 'unsupported-alg' };

  let jwks: { keys: Jwk[] };
  try {
    jwks = await fetchJwks(`https://${config.teamDomain}/cdn-cgi/access/certs`);
  } catch {
    return { ok: false, reason: 'jwks-unavailable' };
  }
  const jwk = jwks.keys.find((k) => k.kid === header.kid);
  if (!jwk) return { ok: false, reason: 'unknown-key' };

  try {
    const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    const valid = await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5',
      key,
      b64urlToBytes(parts[2]),
      new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
    );
    if (!valid) return { ok: false, reason: 'bad-signature' };
  } catch {
    return { ok: false, reason: 'bad-signature' };
  }

  if (claims.iss !== `https://${config.teamDomain}`) return { ok: false, reason: 'bad-issuer' };
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!aud.includes(config.aud)) return { ok: false, reason: 'bad-audience' };
  if (typeof claims.exp !== 'number' || claims.exp + CLOCK_SKEW_S < nowS) return { ok: false, reason: 'expired' };
  if (typeof claims.nbf === 'number' && claims.nbf - CLOCK_SKEW_S > nowS) return { ok: false, reason: 'not-yet-valid' };

  const email = typeof claims.email === 'string' ? claims.email.toLowerCase() : '';
  if (!email || !config.allowedEmails.includes(email)) return { ok: false, reason: 'email-not-allowed' };

  return { ok: true, identity: { email } };
}
