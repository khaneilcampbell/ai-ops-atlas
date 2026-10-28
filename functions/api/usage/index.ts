import { readUsage, type UsageEnv } from "../../../server/usage";

// GET /api/usage: the latest usage snapshot the Mac app pushed. Behind Access like every route.
export const onRequestGet = ({ env }: { env: UsageEnv }) => readUsage(env);

export const onRequest = () => Response.json({ message: "Read-only." }, { status: 405, headers: { allow: "GET" } });
