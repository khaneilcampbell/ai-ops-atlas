import type { LiveEnv } from "../../../server/live";
import { readReportsForApp, receiveReport } from "../../../server/reports";

// POST /api/hooks/reports: an agent's full report, checked against AGENT_FEED_TOKEN (add-only).
// GET /api/hooks/reports?agent=<id>: the Mac app reads them with its sync key. Neither uses Access.
export const onRequestPost = ({ request, env }: { request: Request; env: LiveEnv }) => receiveReport(request, env);
export const onRequestGet = ({ request, env }: { request: Request; env: LiveEnv }) => readReportsForApp(request, env);

export const onRequest = () => Response.json({ message: "Use GET or POST." }, { status: 405, headers: { allow: "GET, POST" } });
