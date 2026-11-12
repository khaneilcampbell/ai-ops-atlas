import { refreshRegistryForApp, type RefreshEnv } from "../../../server/registryRefresh";
import { edgeCache } from "../../../server/properties";

// POST /api/hooks/registry-refresh: the Mac app's Refresh registry sheet, with its sync key instead of Access.
export const onRequestPost = ({ request, env }: { request: Request; env: RefreshEnv }) => refreshRegistryForApp(request, env, edgeCache());

export const onRequest = () => Response.json({ message: "Use POST." }, { status: 405, headers: { allow: "POST" } });
