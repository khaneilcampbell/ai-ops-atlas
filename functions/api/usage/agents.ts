import { readAgentUsage } from "../../../server/agentUsage";
import type { LiveEnv } from "../../../server/live";

// GET /api/usage/agents: model usage the GitHub-run agents reported. Behind Access like every route.
export const onRequestGet = ({ env }: { env: LiveEnv }) => readAgentUsage(env);

export const onRequest = () => Response.json({ message: "Read-only." }, { status: 405, headers: { allow: "GET" } });
