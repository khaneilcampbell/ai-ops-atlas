// Cross-site request check for the Access-protected routes that change something.
// Cloudflare Access signs the browser in with a cookie, so without this a page on another site
// could make a signed-in browser send a POST. Browsers mark every request with Sec-Fetch-Site and
// send Origin on cross-origin POSTs; either one naming another site is refused. Requests with
// neither (curl, Access service tokens) carry no ambient browser session and pass through to the
// normal Access check.

const SAFE = new Set(["GET", "HEAD", "OPTIONS"]);

export function crossSiteWrite(req: Request): boolean {
  if (SAFE.has(req.method.toUpperCase())) return false;
  const site = req.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") return true;
  const origin = req.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).origin !== new URL(req.url).origin;
  } catch {
    return true;
  }
}
