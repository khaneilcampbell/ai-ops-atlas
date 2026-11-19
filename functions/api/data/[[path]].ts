import { forOwner, type DataEnv } from "../../../server/data/api";

// /api/data/*: Khaneil's own reads and writes of the Atlas records, behind Cloudflare Access
// (the middleware checks the session first). See server/data/api.ts for the routes.
type Ctx = { request: Request; env: DataEnv; params: { path?: string | string[] } };
const pathOf = (p: string | string[] | undefined) => (Array.isArray(p) ? p.join("/") : (p ?? ""));

export const onRequestGet = ({ request, env, params }: Ctx) => forOwner(request, env, pathOf(params.path));
export const onRequestPost = ({ request, env, params }: Ctx) => forOwner(request, env, pathOf(params.path));
export const onRequest = () => Response.json({ message: "Use GET or POST." }, { status: 405, headers: { allow: "GET, POST" } });
