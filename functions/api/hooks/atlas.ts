import { receiveAtlas, type LiveEnv } from "../../../server/live";

// POST /api/hooks/atlas: the Mac app's own agent runs. Checked against USAGE_SYNC_TOKEN, not Access.
export const onRequestPost = ({ request, env }: { request: Request; env: LiveEnv }) => receiveAtlas(request, env);

export const onRequest = () => Response.json({ message: "Use POST." }, { status: 405, headers: { allow: "POST" } });
