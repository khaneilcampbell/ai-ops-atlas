import { receiveStepReport, type BridgeEnv } from "../../../server/n8nBridge";

// POST /api/hooks/n8n-report: the n8n step runner reports a step, with N8N_BRIDGE_CALLBACK_TOKEN. Add-only.
export const onRequestPost = ({ request, env }: { request: Request; env: BridgeEnv }) => receiveStepReport(request, env);

export const onRequest = () => Response.json({ message: "Use POST." }, { status: 405, headers: { allow: "POST" } });
