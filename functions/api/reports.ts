import type { LiveEnv } from "../../server/live";
import { readReports } from "../../server/reports";

// GET /api/reports?agent=<id>: an agent's newest full reports for the signed-in page. Behind Access like every route.
export const onRequestGet = ({ request, env }: { request: Request; env: LiveEnv }) => readReports(new URL(request.url), env);

export const onRequest = () => Response.json({ message: "Read-only." }, { status: 405, headers: { allow: "GET" } });
