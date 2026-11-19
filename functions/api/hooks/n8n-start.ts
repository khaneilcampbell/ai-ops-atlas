import { startForApp, type StartEnv } from "../../../server/n8nStart";

// The Mac app's /api/n8n/start, with its sync key instead of Access. The app asks for Touch ID first.
export const onRequestPost = ({ request, env }: { request: Request; env: StartEnv }) => startForApp(request, env);
export const onRequestGet = ({ request, env }: { request: Request; env: StartEnv }) => startForApp(request, env);

export const onRequest = () => Response.json({ message: "Use GET or POST." }, { status: 405, headers: { allow: "GET, POST" } });
