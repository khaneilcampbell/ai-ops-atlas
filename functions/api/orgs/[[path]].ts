import { handleOrgs } from "../../../server/tenancy/api";
import type { TenantEnv } from "../../../server/tenancy/core";

// /api/orgs/*: organizations, members, workspaces, tenant records, integrations, usage and quotas.
// Answers 503 until the site has a TENANT database and TENANCY_ENABLED=1 (docs/multi-tenancy.md).
export const onRequest = ({ request, env }: { request: Request; env: TenantEnv }) => handleOrgs(request, env);
