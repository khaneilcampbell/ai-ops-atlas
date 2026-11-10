import { readSecurityForApp, type SecurityEnv } from "../../../server/security";
import { edgeCache } from "../../../server/properties";

// GET /api/hooks/security?repos=…: the same alert counts for the Mac app, with its sync key instead of Access.
export const onRequestGet = ({ request, env }: { request: Request; env: SecurityEnv }) => readSecurityForApp(request, env, edgeCache());

export const onRequest = () => Response.json({ message: "Read-only." }, { status: 405, headers: { allow: "GET" } });
