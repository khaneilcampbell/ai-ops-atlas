import { routeOutputsForApp, type OutputsEnv } from "../../../../server/outputs";

// GET /api/hooks/library[...]: the Output Library for the Mac app, with its website sync key instead
// of Access. Read-only (list, one output, a version's file); retry and reconcile stay on the web page.
export const onRequestGet = ({ request, env }: { request: Request; env: OutputsEnv }) => routeOutputsForApp(request, env);

export const onRequest = () => Response.json({ message: "Read-only." }, { status: 405, headers: { allow: "GET" } });
