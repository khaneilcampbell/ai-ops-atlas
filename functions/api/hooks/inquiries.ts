import type { LiveEnv } from "../../../server/live";
import { readInquiriesForApp, receiveInquiry } from "../../../server/inquiries";

// POST /api/hooks/inquiries: one website inquiry from the benjaire.com Worker, checked against AGENT_FEED_TOKEN (add-only).
// GET /api/hooks/inquiries: the Mac app reads them with its sync key. Neither uses Access.
export const onRequestPost = ({ request, env }: { request: Request; env: LiveEnv }) => receiveInquiry(request, env);
export const onRequestGet = ({ request, env }: { request: Request; env: LiveEnv }) => readInquiriesForApp(request, env);

export const onRequest = () => Response.json({ message: "Use GET or POST." }, { status: 405, headers: { allow: "GET, POST" } });
