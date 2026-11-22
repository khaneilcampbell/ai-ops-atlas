import { forHook, type ExecutiveEnv } from "../../../server/executive/api";

// n8n "Atlas · Executive Dispatch" posts ATLAS_WORKFLOW_RESULT / ATLAS_EXECUTIVE_ERROR here with the
// callback key (N8N_BRIDGE_CALLBACK_TOKEN). No Access session: the key and the dispatch record decide.
export const onRequestPost = ({ request, env }: { request: Request; env: ExecutiveEnv }) => forHook(request, env, "result");
export const onRequest = () => Response.json({ message: "Use POST." }, { status: 405, headers: { allow: "POST" } });
