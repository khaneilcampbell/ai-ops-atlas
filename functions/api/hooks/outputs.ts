import type { OutputsEnv } from "../../../server/outputs";
import { receiveOutputs } from "../../../server/outputs";

// POST /api/hooks/outputs: a workflow or agent adds the files it produced, checked against the
// add-only AGENT_FEED_TOKEN. It can't list, preview or download anything (that is /api/outputs, behind Access).
export const onRequestPost = ({ request, env }: { request: Request; env: OutputsEnv }) => receiveOutputs(request, env);

export const onRequest = () => Response.json({ message: "Add-only: use POST." }, { status: 405, headers: { allow: "POST" } });
