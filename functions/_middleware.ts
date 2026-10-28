import { verifyAccess, type AccessEnv } from "../server/access";
import { HOOKS_PREFIX } from "../server/live";
import { PUSH_PATH } from "../server/usage";

// Every function route (/api/*) needs a valid Cloudflare Access session, except the Mac app's
// usage push and the live hooks (GitHub webhooks, the Mac app's feed), which have no Access
// session and check their own secrets instead.
export const onRequest = async (ctx: { request: Request; env: AccessEnv; next: () => Promise<Response> }) => {
  const path = new URL(ctx.request.url).pathname;
  if (path === PUSH_PATH || path.startsWith(HOOKS_PREFIX)) return ctx.next();
  const res = await verifyAccess(ctx.request.headers.get("cf-access-jwt-assertion"), ctx.env);
  if (!res.ok) return Response.json({ message: res.reason }, { status: res.status, headers: { "cache-control": "no-store" } });
  return ctx.next();
};
