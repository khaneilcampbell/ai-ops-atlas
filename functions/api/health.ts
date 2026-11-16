import { readHealth, type HealthEnv } from "../../server/health";
import { edgeCache } from "../../server/properties";

// GET /api/health: production health of the site and its integrations. Behind Access like every route.
export const onRequestGet = ({ env }: { env: HealthEnv }) => readHealth(env, edgeCache());

export const onRequest = () => Response.json({ message: "Read-only." }, { status: 405, headers: { allow: "GET" } });
