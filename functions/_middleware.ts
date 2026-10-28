import { verifyAccess, type AccessEnv } from "../server/access";
import { PUSH_PATH } from "../server/usage";

// Every function route (/api/*) needs a valid Cloudflare Access session, except the Mac app's
// usage push, which has no Access session and checks its own shared secret instead.
export const onRequest = async (ctx: { request: Request; env: AccessEnv; next: () => Promise<Response> }) => {
  if (new URL(ctx.request.url).pathname === PUSH_PATH) return ctx.next();
  const res = await verifyAccess(ctx.request.headers.get("cf-access-jwt-assertion"), ctx.env);
  if (!res.ok) return Response.json({ message: res.reason }, { status: res.status, headers: { "cache-control": "no-store" } });
  return ctx.next();
};
