// Response helpers and security headers shared by every route.

// Static UI: own scripts and styles only. Preact sets inline styles through
// the CSSOM, which CSP allows without 'unsafe-inline'.
export const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "object-src 'none'",
].join('; ');

export const SECURITY_HEADERS: Record<string, string> = {
  'Content-Security-Policy': CSP,
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'X-Robots-Tag': 'noindex, nofollow',
};

export function withSecurityHeaders(res: Response, extra: Record<string, string> = {}): Response {
  const out = new Response(res.body, res);
  for (const [k, v] of Object.entries({ ...SECURITY_HEADERS, ...extra })) out.headers.set(k, v);
  return out;
}

export function json(body: unknown, status = 200): Response {
  return withSecurityHeaders(
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8' } }),
    { 'Cache-Control': 'no-store' },
  );
}

export function apiError(status: number, error: string, extra: Record<string, unknown> = {}): Response {
  return json({ ok: false, error, ...extra }, status);
}

/** Writes must come from the dashboard itself, as JSON (CSRF defense). */
export function sameOriginJson(req: Request): boolean {
  const origin = req.headers.get('Origin');
  if (!origin || origin !== new URL(req.url).origin) return false;
  return (req.headers.get('Content-Type') ?? '').toLowerCase().startsWith('application/json');
}

export const MAX_BODY = 10_000;

export async function readJson(req: Request): Promise<unknown> {
  const length = Number(req.headers.get('Content-Length') ?? '0');
  if (length > MAX_BODY) throw new Error('too-large');
  const text = await req.text();
  if (text.length > MAX_BODY) throw new Error('too-large');
  return JSON.parse(text);
}
