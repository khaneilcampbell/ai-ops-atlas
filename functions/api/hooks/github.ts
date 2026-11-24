import { forGithubEvent, type ExecutiveEnv } from "../../../server/executive/api";
import { receiveGithub, type LiveEnv } from "../../../server/live";

// POST /api/hooks/github: GitHub App webhook deliveries. Checked against GITHUB_WEBHOOK_SECRET, not Access.
// A verified workflow_run also goes to the Engineering Division's intake after the reply is sent
// (waitUntil), so a slow database or GitHub read never delays or fails the delivery.
type Ctx = { request: Request; env: LiveEnv & ExecutiveEnv; waitUntil: (p: Promise<unknown>) => void };
export const onRequestPost = ({ request, env, waitUntil }: Ctx) => receiveGithub(request, env, Date.now(), (event, payload) => waitUntil(forGithubEvent(env, event, payload)));

export const onRequest = () => Response.json({ message: "Use POST." }, { status: 405, headers: { allow: "POST" } });
