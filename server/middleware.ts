import { verifyAccess, type AccessEnv } from "./access";
import { HOOKS_PREFIX } from "./live";
import { PUSH_PATH } from "./usage";
import { crossSiteWrite } from "./origin";
import { logEvent, requestIdOf, type Sink } from "./log";

// Every function route (/api/*) needs a valid Cloudflare Access session, except the Mac app's
// usage push and the live hooks (GitHub webhooks, the Mac app's feed), which have no Access
// session and check their own secrets instead. Access routes that change something also refuse
// requests a browser marks as coming from another site, so a signed-in session can't be used by
// a page elsewhere. Every refusal and server error is logged as one redacted JSON line with a
// request id that the response carries in `x-request-id`.

const SERVICE = "pages-functions";

export function withRequestId(res: Response, id: string): Response {
  const out = new Response(res.body, res);
  out.headers.set("x-request-id", id);
  return out;
}

export const handle = async (ctx: { request: Request; env: AccessEnv; next: () => Promise<Response> }, sink?: Sink): Promise<Response> => {
  const started = Date.now();
  const req = ctx.request;
  const url = new URL(req.url);
  const path = url.pathname;
  const requestId = requestIdOf(req);
  const base = { service: SERVICE, requestId, path, method: req.method };
  const deny = (status: number, message: string, event: string) => {
    logEvent({ ...base, event, severity: "warn", status, detail: message }, sink);
    return Response.json({ message, requestId }, { status, headers: { "cache-control": "no-store", "x-request-id": requestId } });
  };

  const hook = path === PUSH_PATH || path.startsWith(HOOKS_PREFIX);
  if (!hook) {
    const res = await verifyAccess(req.headers.get("cf-access-jwt-assertion"), ctx.env);
    if (!res.ok) return deny(res.status, res.reason, res.status === 503 ? "auth.unavailable" : "auth.denied");
    if (crossSiteWrite(req)) return deny(403, "Changes must come from the Atlas page itself.", "auth.cross_site");
  }

  let res: Response;
  try {
    res = await ctx.next();
  } catch (e) {
    logEvent({ ...base, event: "api.error", severity: "error", status: 500, durationMs: Date.now() - started, detail: e instanceof Error ? e.message : String(e) }, sink);
    return Response.json({ message: "Atlas hit an unexpected error. Try again shortly.", requestId }, { status: 500, headers: { "cache-control": "no-store", "x-request-id": requestId } });
  }
  if (res.status === 401 || res.status === 403) logEvent({ ...base, event: hook ? "auth.hook_denied" : "auth.denied", severity: "warn", status: res.status, durationMs: Date.now() - started }, sink);
  else if (res.status >= 500) logEvent({ ...base, event: res.status === 503 ? "api.unavailable" : "api.error", severity: res.status === 503 ? "warn" : "error", status: res.status, durationMs: Date.now() - started }, sink);
  return withRequestId(res, requestId);
};

