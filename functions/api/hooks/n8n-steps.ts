import { forApp, type BridgeEnv } from "../../../server/n8nBridge";

// The Mac app's /api/n8n/steps, with its sync key instead of Access.
export const onRequestPost = ({ request, env }: { request: Request; env: BridgeEnv }) => forApp(request, env);
export const onRequestGet = ({ request, env }: { request: Request; env: BridgeEnv }) => forApp(request, env);

export const onRequest = () => Response.json({ message: "Use GET or POST." }, { status: 405, headers: { allow: "GET, POST" } });
