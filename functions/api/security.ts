import { readSecurity, type SecurityEnv } from "../../server/security";
import { edgeCache } from "../../server/properties";

// GET /api/security?repos=…: open GitHub security alert counts for the Security Operations Center. Behind Access like every route.
export const onRequestGet = ({ request, env }: { request: Request; env: SecurityEnv }) => readSecurity(request, env, edgeCache());

export const onRequest = () => Response.json({ message: "Read-only." }, { status: 405, headers: { allow: "GET" } });
