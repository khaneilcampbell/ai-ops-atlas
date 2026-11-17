// /api/orgs/* : the organization API. Behind Cloudflare Access like every other /api route
// (functions/_middleware.ts), and the identity is verified again here. Each route names the one
// permission it needs; authorize() reads the caller's membership fresh from the database.
//
// Switched off unless the site has a TENANT database bound AND TENANCY_ENABLED=1, so merging this
// changes nothing on the live site until Khaneil applies the migration and turns it on.

import { reply } from "../http";
import type { Action } from "../../src/tenancy/permissions";
import { effectiveEntitlement, PLANS } from "../../src/tenancy/plans";
import { accessIdentity, audit, authorize, isPlatformAdmin, mayCreateOrgs, tenancyOn, type Authorized, type Identify, type TenantEnv } from "./core";
import { authorizeDispatch, retryDispatch } from "./dispatch";
import { quotaStatus, setQuotaOverride, usageForPeriod } from "./metering";
import * as repo from "./repo";
import { addIntegration, checkIntegration, listIntegrations, revokeIntegration, rotateIntegration, type Checker } from "./vault";

const MAX_JSON = 70_000;

async function json(req: Request): Promise<Record<string, unknown> | null> {
  const text = await req.text();
  if (text.length > MAX_JSON) return null;
  try {
    const v = text ? JSON.parse(text) : {};
    return v && typeof v === "object" && !Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

const answer = <T>(r: repo.Result<T>, okStatus = 200) => (r.ok ? reply(okStatus, r.value ?? { ok: true }) : reply(r.status, { message: r.message }));

export interface ApiDeps {
  identify?: Identify;
  now?: number;
  checker?: Checker;
}

export async function handleOrgs(req: Request, env: TenantEnv, deps: ApiDeps = {}): Promise<Response> {
  if (!tenancyOn(env)) return reply(503, { message: "Organizations aren't switched on for this site yet.", enabled: false });
  const db = env.TENANT;
  const now = deps.now ?? Date.now();
  const who = await (deps.identify ?? accessIdentity)(req, env);
  if ("status" in who) return reply(who.status, { message: who.reason });
  const userId = who.userId;
  const url = new URL(req.url);
  const parts = url.pathname.replace(/^\/api\/orgs\/?/, "").split("/").filter(Boolean).map(decodeURIComponent);
  const method = req.method.toUpperCase();

  // /api/orgs
  if (parts.length === 0) {
    if (method === "GET") return reply(200, { orgs: await repo.listMyOrgs(db, userId), canCreate: mayCreateOrgs(env, userId) });
    if (method === "POST") {
      if (!mayCreateOrgs(env, userId)) {
        await audit(db, { orgId: null, actor: userId, action: "org.create", outcome: "denied" }, now);
        return reply(403, { message: "Your account can't create organizations." });
      }
      const body = await json(req);
      if (!body) return reply(400, { message: "Body isn't a JSON object." });
      return answer(await repo.createOrg(db, userId, body, now, isPlatformAdmin(env, userId)), 201);
    }
    return reply(405, { message: "Use GET or POST." });
  }

  // /api/orgs/templates  (shared agent templates: everyone signed in reads, platform admins write)
  if (parts[0] === "templates") {
    if (method === "GET" && parts.length === 1) return reply(200, { templates: await repo.listTemplates(db) });
    if (method === "PUT" && parts.length === 2) {
      if (!isPlatformAdmin(env, userId)) {
        await audit(db, { orgId: null, actor: userId, action: "template.put", target: parts[1], outcome: "denied" }, now);
        return reply(403, { message: "Only a platform admin can change shared templates." });
      }
      const body = await json(req);
      if (!body) return reply(400, { message: "Body isn't a JSON object." });
      return answer(await repo.putTemplate(db, userId, parts[1], body, now));
    }
    return reply(405, { message: "Templates are read-only here." });
  }

  const [orgId, section, a1, a2] = parts;
  const gate = async (action: Action): Promise<Authorized | Response> => {
    const r = await authorize(db, userId, orgId, action, now);
    return r.ok ? r : reply(r.status, { message: r.message });
  };
  const body = async () => (method === "GET" || method === "DELETE" ? {} : await json(req));

  // /api/orgs/:org
  if (!section) {
    if (method === "GET") {
      const a = await gate("org.read");
      if (a instanceof Response) return a;
      const ent = effectiveEntitlement(repo.settingsOf(a.org));
      return reply(200, { id: a.org.id, name: a.org.name, slug: a.org.slug, status: a.org.status, role: a.role, protected: !!a.org.protected, plan: { id: ent.id, label: ent.label, commerciallyAvailable: false }, createdAt: a.org.created_at });
    }
    if (method === "PATCH") {
      const a = await gate("org.update");
      if (a instanceof Response) return a;
      const b = await body();
      return b ? answer(await repo.updateOrg(db, a, b, now)) : reply(400, { message: "Body isn't a JSON object." });
    }
    return reply(405, { message: "Use GET or PATCH." });
  }

  const b = await body();
  if (!b) return reply(400, { message: "Body isn't a JSON object." });

  switch (section) {
    case "delete": {
      if (method !== "POST") break;
      const a = await gate("org.delete");
      return a instanceof Response ? a : answer(await repo.deleteOrg(db, a, b, now));
    }
    case "members": {
      if (method === "GET" && !a1) {
        const a = await gate("member.read");
        return a instanceof Response ? a : reply(200, { members: await repo.listMembers(db, a) });
      }
      const a = await gate("member.manage");
      if (a instanceof Response) return a;
      if (method === "POST" && !a1) return answer(await repo.setMembership(db, a, b.userId, b.role, now), 201);
      if (method === "PATCH" && a1) return answer(await repo.setMembership(db, a, a1, b.role, now));
      if (method === "DELETE" && a1) return answer(await repo.setMembership(db, a, a1, null, now));
      break;
    }
    case "workspaces": {
      if (method === "GET") {
        const a = await gate("workspace.read");
        return a instanceof Response ? a : reply(200, { workspaces: await repo.listWorkspaces(db, a) });
      }
      if (method === "POST") {
        const a = await gate("workspace.manage");
        return a instanceof Response ? a : answer(await repo.createWorkspace(db, a, b, now), 201);
      }
      break;
    }
    case "resources": {
      if (!repo.isKind(a1)) return reply(400, { message: `Kind must be one of ${repo.RESOURCE_KINDS.join(", ")}.` });
      if (method === "GET" && !a2) {
        const a = await gate("resource.read");
        return a instanceof Response ? a : reply(200, { items: await repo.listResources(db, a, a1, url.searchParams.get("workspace")) });
      }
      if (!a2 || !repo.validId(a2)) return reply(400, { message: "Record id required." });
      if (method === "GET") {
        const a = await gate("resource.read");
        if (a instanceof Response) return a;
        const r = await repo.getResourceIn(db, a.org.id, a1, a2);
        return r ? reply(200, repo.publicResource(r)) : reply(404, { message: "No such record." });
      }
      if (method === "PUT") {
        const a = await gate("resource.write");
        return a instanceof Response ? a : answer(await repo.putResource(db, a, a1, a2, b, now));
      }
      if (method === "DELETE") {
        const a = await gate("resource.delete");
        return a instanceof Response ? a : answer(await repo.deleteResource(db, a, a1, a2, now));
      }
      break;
    }
    case "approvals": {
      if (method !== "POST" || !a1) break;
      const a = await gate("approval.decide");
      return a instanceof Response ? a : answer(await repo.decideApproval(db, a, a1, b, now));
    }
    case "dispatch": {
      if (method !== "POST") break;
      const a = await gate("workflow.execute");
      if (a instanceof Response) return a;
      return a1 && a2 === "retry" ? answer(await retryDispatch(db, a, a1, now), 201) : answer(await authorizeDispatch(db, a, b, now), 201);
    }
    case "integrations": {
      if (method === "GET" && !a1) {
        const a = await gate("integration.read");
        return a instanceof Response ? a : reply(200, { integrations: await listIntegrations(db, a) });
      }
      const a = await gate("integration.manage");
      if (a instanceof Response) return a;
      if (method === "POST" && !a1) return answer(await addIntegration(db, env, a, b, now), 201);
      if (method === "POST" && a2 === "rotate") return answer(await rotateIntegration(db, env, a, a1, b.secret, now));
      if (method === "POST" && a2 === "revoke") return answer(await revokeIntegration(db, a, a1, now));
      if (method === "POST" && a2 === "check") return answer(await checkIntegration(db, env, a, a1, now, deps.checker));
      break;
    }
    case "usage": {
      if (method !== "GET") break;
      const a = await gate("usage.read");
      if (a instanceof Response) return a;
      const u = await usageForPeriod(db, a, url.searchParams.get("period") ?? new Date(now).toISOString().slice(0, 7));
      return u ? reply(200, u) : reply(400, { message: "period must be YYYY-MM." });
    }
    case "quotas": {
      if (method === "GET") {
        const a = await gate("usage.read");
        return a instanceof Response ? a : reply(200, await quotaStatus(db, a, now));
      }
      if (method === "PUT") {
        const a = await gate("quota.override");
        return a instanceof Response ? a : answer(await setQuotaOverride(db, a, b.metric, b.value ?? null, now));
      }
      break;
    }
    case "entitlements": {
      const a = await gate("org.read");
      return a instanceof Response ? a : reply(200, { current: effectiveEntitlement(repo.settingsOf(a.org)), plans: Object.values(PLANS) });
    }
    case "audit": {
      if (method !== "GET") break;
      const a = await gate("audit.read");
      if (a instanceof Response) return a;
      const { results } = await db.prepare("SELECT at, actor, action, target, outcome, correlation_id AS correlationId, detail FROM audit_events WHERE org_id = ? ORDER BY at DESC LIMIT 200").bind(a.org.id).all();
      return reply(200, { events: results });
    }
  }
  return reply(405, { message: "That method isn't supported here." });
}
