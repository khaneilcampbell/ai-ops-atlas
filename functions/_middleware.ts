import type { AccessEnv } from "../server/access";
import { handle } from "../server/middleware";

// The checks live in server/middleware.ts so they can be tested: Access on every /api route except
// the hooks (which check their own secrets), a same-site check on changes, and redacted request logs.
export const onRequest = (ctx: { request: Request; env: AccessEnv; next: () => Promise<Response> }) => handle(ctx);
