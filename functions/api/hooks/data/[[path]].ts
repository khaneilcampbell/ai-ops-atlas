import { forAgent, type DataEnv } from "../../../../server/data/api";

// /api/hooks/data/*: n8n and agents, each with its own key from ATLAS_DATA_KEYS (no Access session).
// Each key only reaches the areas and tables listed for it in server/data/policy.ts.
type Ctx = { request: Request; env: DataEnv; params: { path?: string | string[] } };
const pathOf = (p: string | string[] | undefined) => (Array.isArray(p) ? p.join("/") : (p ?? ""));

export const onRequestGet = ({ request, env, params }: Ctx) => forAgent(request, env, pathOf(params.path));
export const onRequestPost = ({ request, env, params }: Ctx) => forAgent(request, env, pathOf(params.path));
export const onRequest = () => Response.json({ message: "Use GET or POST." }, { status: 405, headers: { allow: "GET, POST" } });
