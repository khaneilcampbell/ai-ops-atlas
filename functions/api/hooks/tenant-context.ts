import { agentContext } from "../../../server/tenancy/dispatch";
import { tenancyOn, type TenantEnv } from "../../../server/tenancy/core";
import { reply } from "../../../server/http";

// GET /api/hooks/tenant-context?dispatch=&kind=&id=: a record an agent may read while its dispatch
// runs, only from the dispatch's own organization and workspace.
export const onRequestGet = ({ request, env }: { request: Request; env: TenantEnv }) =>
  tenancyOn(env) ? agentContext(env.TENANT, env, request, Date.now()) : reply(503, { message: "Organizations aren't switched on for this site yet." });

export const onRequest = () => Response.json({ message: "Use GET." }, { status: 405, headers: { allow: "GET" } });
