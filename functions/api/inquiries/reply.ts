import type { LiveEnv } from "../../../server/live";
import { sendReply, type ReplyEnv } from "../../../server/inquiryReply";

// POST /api/inquiries/reply: send KC's reviewed reply as the designed email. Behind Access like every route.
export const onRequestPost = ({ request, env }: { request: Request; env: LiveEnv & ReplyEnv }) => sendReply(request, env);

export const onRequest = () => Response.json({ message: "Use POST." }, { status: 405, headers: { allow: "POST" } });
