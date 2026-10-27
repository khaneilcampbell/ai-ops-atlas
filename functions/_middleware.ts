import { verifyAccess, type AccessEnv } from "../server/access";

// Every function route (/api/*) needs a valid Cloudflare Access session.
export const onRequest = async (ctx: { request: Request; env: AccessEnv; next: () => Promise<Response> }) => {
  const res = await verifyAccess(ctx.request.headers.get("cf-access-jwt-assertion"), ctx.env);
  if (!res.ok) return Response.json({ message: res.reason }, { status: res.status, headers: { "cache-control": "no-store" } });
  return ctx.next();
};
