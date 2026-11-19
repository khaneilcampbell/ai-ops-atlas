import { salesForApp, type SalesEnv } from "../../../server/stripeSales";

// The Mac app's /api/n8n/sales, with its sync key instead of Access.
export const onRequestPost = ({ request, env }: { request: Request; env: SalesEnv }) => salesForApp(request, env);
export const onRequestGet = ({ request, env }: { request: Request; env: SalesEnv }) => salesForApp(request, env);

export const onRequest = () => Response.json({ message: "Use GET or POST." }, { status: 405, headers: { allow: "GET, POST" } });
