import { forApp, type DataEnv } from "../../../server/data/api";

// GET /api/hooks/data-overview: the Task Center's database overview for the Mac app, with its website
// sync key instead of Access. Read-only; approvals are decided on the web page.
export const onRequestGet = ({ request, env }: { request: Request; env: DataEnv }) => forApp(request, env);

export const onRequest = () => Response.json({ message: "Read-only." }, { status: 405, headers: { allow: "GET" } });
