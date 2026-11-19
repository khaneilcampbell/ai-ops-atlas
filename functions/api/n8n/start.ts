import { readStarts, startWorkflow, type StartEnv } from "../../../server/n8nStart";

// POST /api/n8n/start: start one allow-listed n8n workflow (src/n8n/startable.ts), signed by the site.
// GET /api/n8n/start?status=1 (is it set up) or ?idem=<key> (one start's record). Behind Access.
export const onRequestPost = ({ request, env }: { request: Request; env: StartEnv }) => startWorkflow(request, env);
export const onRequestGet = ({ request, env }: { request: Request; env: StartEnv }) => readStarts(new URL(request.url), env);

export const onRequest = () => Response.json({ message: "Use GET or POST." }, { status: 405, headers: { allow: "GET, POST" } });
