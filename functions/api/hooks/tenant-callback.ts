import { receiveCallback } from "../../../server/tenancy/dispatch";
import { tenancyOn, type TenantEnv } from "../../../server/tenancy/core";
import { reply } from "../../../server/http";

// POST /api/hooks/tenant-callback: an execution worker reports a tenant dispatch's result. Needs the
// TENANT_CALLBACK_TOKEN bearer key AND the dispatch's own key; the organization comes from the
// stored dispatch, never from the body.
export const onRequestPost = ({ request, env }: { request: Request; env: TenantEnv }) =>
  tenancyOn(env) ? receiveCallback(env.TENANT, env, request, Date.now()) : reply(503, { message: "Organizations aren't switched on for this site yet." });

export const onRequest = () => Response.json({ message: "Use POST." }, { status: 405, headers: { allow: "POST" } });
