import { routeOutputs, type OutputsEnv } from "../../../server/outputs";

// /api/outputs[...]: the Output Library for the signed-in page. Behind Cloudflare Access like every
// /api route (functions/_middleware.ts), and changes (reconcile, retry) must come from the page itself.
export const onRequest = ({ request, env }: { request: Request; env: OutputsEnv }) => routeOutputs(request, env);
