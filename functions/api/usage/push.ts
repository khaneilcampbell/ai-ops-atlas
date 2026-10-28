import { pushUsage, type UsageEnv } from "../../../server/usage";

// PUT /api/usage/push: the Mac app replaces the snapshot. Checked against USAGE_SYNC_TOKEN, not Access.
export const onRequestPut = ({ request, env }: { request: Request; env: UsageEnv }) => pushUsage(request, env);

export const onRequest = () => Response.json({ message: "Use PUT." }, { status: 405, headers: { allow: "PUT" } });
