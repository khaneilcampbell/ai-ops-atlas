import { dispatchStep, readStepReports, type BridgeEnv } from "../../../server/n8nBridge";

// POST /api/n8n/steps: send one allow-listed research or planning step to the n8n step runner.
// GET /api/n8n/steps?since=<id>: step reports to pick up (?status=1: is the bridge set up). Behind Access.
export const onRequestPost = ({ request, env }: { request: Request; env: BridgeEnv }) => dispatchStep(request, env);
export const onRequestGet = ({ request, env }: { request: Request; env: BridgeEnv }) => readStepReports(new URL(request.url), env);

export const onRequest = () => Response.json({ message: "Use GET or POST." }, { status: 405, headers: { allow: "GET, POST" } });
