import type { LiveEnv } from "../../../../server/live";
import { sendReplyForApp, type ReplyEnv } from "../../../../server/inquiryReply";

// POST /api/hooks/inquiries/reply: the Mac app sends a reviewed reply with its sync key (no Access).
export const onRequestPost = ({ request, env }: { request: Request; env: LiveEnv & ReplyEnv }) => sendReplyForApp(request, env);

export const onRequest = () => Response.json({ message: "Use POST." }, { status: 405, headers: { allow: "POST" } });
