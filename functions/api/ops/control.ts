import { opsControl, type OpsEnv } from "../../../server/opsControl";

// GET /api/ops/control: the Phase 9 emergency stop state. POST {active, reason}: turn it on or off.
// Behind Access like every non-hook route, with the same-site check on changes.
export const onRequest = ({ request, env }: { request: Request; env: OpsEnv }) => opsControl(request, env);
