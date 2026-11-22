import { forOwner, type ExecutiveEnv } from "../../../server/executive/api";

// /api/executive/*: Khaneil's Atlas Executive controls, behind Cloudflare Access (the middleware
// checks the session and refuses cross-site writes first). See server/executive/api.ts.
type Ctx = { request: Request; env: ExecutiveEnv; params: { path?: string | string[] } };
const pathOf = (p: string | string[] | undefined) => (Array.isArray(p) ? p.join("/") : (p ?? ""));

export const onRequestGet = ({ request, env, params }: Ctx) => forOwner(request, env, pathOf(params.path));
export const onRequestPost = ({ request, env, params }: Ctx) => forOwner(request, env, pathOf(params.path));
export const onRequest = () => Response.json({ message: "Use GET or POST." }, { status: 405, headers: { allow: "GET, POST" } });
