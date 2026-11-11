import { readN8n, type N8nEnv } from "../../server/n8n";
import { edgeCache } from "../../server/properties";

// GET /api/n8n: recent n8n workflow runs for the Workflow Automation Plant. Behind Access like every route.
export const onRequestGet = ({ env }: { env: N8nEnv }) => readN8n(env, edgeCache());

export const onRequest = () => Response.json({ message: "Read-only." }, { status: 405, headers: { allow: "GET" } });
