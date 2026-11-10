import { readN8nForApp, type N8nEnv } from "../../../server/n8n";
import { edgeCache } from "../../../server/properties";

// GET /api/hooks/n8n: the same n8n run summary for the Mac app, with its sync key instead of Access.
export const onRequestGet = ({ request, env }: { request: Request; env: N8nEnv }) => readN8nForApp(request, env, edgeCache());

export const onRequest = () => Response.json({ message: "Read-only." }, { status: 405, headers: { allow: "GET" } });
