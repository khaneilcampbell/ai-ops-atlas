import { forHook, type ExecutiveEnv } from "../../../server/executive/api";

// n8n "Atlas · Executive Schedule" (ATLAS_EXECUTIVE_SCHEDULE): reconciliation only, with the callback key.
export const onRequestPost = ({ request, env }: { request: Request; env: ExecutiveEnv }) => forHook(request, env, "tick");
export const onRequest = () => Response.json({ message: "Use POST." }, { status: 405, headers: { allow: "POST" } });
