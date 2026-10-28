import { readEvents, type LiveEnv } from "../../server/live";

// GET /api/events?after=<id>: the live feed for the signed-in page. Behind Access like every route.
export const onRequestGet = ({ request, env }: { request: Request; env: LiveEnv }) => readEvents(new URL(request.url), env);

export const onRequest = () => Response.json({ message: "Read-only." }, { status: 405, headers: { allow: "GET" } });
