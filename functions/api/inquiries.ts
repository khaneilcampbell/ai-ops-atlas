import type { LiveEnv } from "../../server/live";
import { readInquiries } from "../../server/inquiries";

// GET /api/inquiries: the newest website inquiries for the signed-in page. Behind Access like every route.
export const onRequestGet = ({ env }: { env: LiveEnv }) => readInquiries(env);

export const onRequest = () => Response.json({ message: "Read-only." }, { status: 405, headers: { allow: "GET" } });
