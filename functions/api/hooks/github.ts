import { receiveGithub, type LiveEnv } from "../../../server/live";

// POST /api/hooks/github: GitHub App webhook deliveries. Checked against GITHUB_WEBHOOK_SECRET, not Access.
export const onRequestPost = ({ request, env }: { request: Request; env: LiveEnv }) => receiveGithub(request, env);

export const onRequest = () => Response.json({ message: "Use POST." }, { status: 405, headers: { allow: "POST" } });
