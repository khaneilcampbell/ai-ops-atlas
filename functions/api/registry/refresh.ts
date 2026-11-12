import { refreshRegistry, type RefreshEnv } from "../../../server/registryRefresh";
import { edgeCache } from "../../../server/properties";

// POST /api/registry/refresh: run the n8n Agent Registry workflow now. Behind Access like every route.
export const onRequestPost = ({ env }: { env: RefreshEnv }) => refreshRegistry(env, edgeCache());

export const onRequest = () => Response.json({ message: "Use POST." }, { status: 405, headers: { allow: "POST" } });
