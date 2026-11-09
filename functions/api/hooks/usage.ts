import { readAgentUsageForApp, receiveAgentUsage } from "../../../server/agentUsage";
import type { LiveEnv } from "../../../server/live";

// POST /api/hooks/usage: model usage from agents outside the Mac app, checked against AGENT_FEED_TOKEN (add-only).
// GET /api/hooks/usage: the Mac app reads it with its sync key. Neither uses Access.
export const onRequestPost = ({ request, env }: { request: Request; env: LiveEnv }) => receiveAgentUsage(request, env);
export const onRequestGet = ({ request, env }: { request: Request; env: LiveEnv }) => readAgentUsageForApp(request, env);

export const onRequest = () => Response.json({ message: "Use GET or POST." }, { status: 405, headers: { allow: "GET, POST" } });
