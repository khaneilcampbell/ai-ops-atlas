import { readHealthForApp, type HealthEnv } from "../../../server/health";
import { edgeCache } from "../../../server/properties";

// GET /api/hooks/health: the same health report for the Mac app, with its sync key instead of Access.
export const onRequestGet = ({ request, env }: { request: Request; env: HealthEnv }) => readHealthForApp(request, env, edgeCache());

export const onRequest = () => Response.json({ message: "Read-only." }, { status: 405, headers: { allow: "GET" } });
