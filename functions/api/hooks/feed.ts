import { readFeed, type LiveEnv } from "../../../server/live";

// GET /api/hooks/feed?after=<id>: the live feed for the Mac app. Checked against USAGE_SYNC_TOKEN, not Access.
export const onRequestGet = ({ request, env }: { request: Request; env: LiveEnv }) => readFeed(request, env);

export const onRequest = () => Response.json({ message: "Read-only." }, { status: 405, headers: { allow: "GET" } });
