import { receiveAgents, type LiveEnv } from "../../../server/live";

// POST /api/hooks/agents: phase results from pipelines outside Atlas. Checked against AGENT_FEED_TOKEN, not Access.
export const onRequestPost = ({ request, env }: { request: Request; env: LiveEnv }) => receiveAgents(request, env);

export const onRequest = () => Response.json({ message: "Use POST." }, { status: 405, headers: { allow: "POST" } });
