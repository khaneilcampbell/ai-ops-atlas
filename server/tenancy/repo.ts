// Tenant-scoped data access. Every function takes an `Authorized` context from core.authorize and
// binds its organization id into every statement, so a query can't reach another organization's
// rows whatever ids the request carries. Callers never pass an organization id of their own.

import type { D1 } from "../live";
import { looksSecret } from "../../src/lib/secretPatterns";
import { isRole, roleChangeProblem, type Role } from "../../src/tenancy/permissions";
import { effectiveEntitlement, isPlanId, type OrgPlanSettings } from "../../src/tenancy/plans";
import { audit, auditStatement, changes, first, newId, nowIso, type Authorized, type OrgRow } from "./core";

import { impliedRefs, isKind, type Ref, type ResourceKind } from "../../src/tenancy/model";
export { impliedRefs, isKind, RESOURCE_KINDS, type Ref, type ResourceKind } from "../../src/tenancy/model";

export const MAX_BODY_BYTES = 64_000;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,46}[a-z0-9])?$/;
export const validId = (v: unknown): v is string => typeof v === "string" && ID.test(v);

export type Result<T> = { ok: true; value: T } | { ok: false; status: number; message: string };
const fail = (status: number, message: string) => ({ ok: false as const, status, message });
const done = <T>(value: T) => ({ ok: true as const, value });

export const settingsOf = (org: Pick<OrgRow, "settings">): OrgPlanSettings & Record<string, unknown> => {
  try {
    const s = JSON.parse(org.settings);
    return s && typeof s === "object" ? s : {};
  } catch {
    return {};
  }
};

// ── Organizations ────────────────────────────────────────────────────────────

export interface OrgSummary {
  id: string;
  name: string;
  slug: string;
  status: string;
  role: Role;
}

export async function listMyOrgs(db: D1, userId: string): Promise<OrgSummary[]> {
  const { results } = await db
    .prepare("SELECT o.id, o.name, o.slug, o.status, m.role FROM memberships m JOIN organizations o ON o.id = m.org_id WHERE m.user_id = ? AND m.status = 'active' AND o.status != 'deleted' ORDER BY o.name")
    .bind(userId)
    .all<OrgSummary>();
  return results;
}

/** Creates an organization with the caller as its only owner and one default workspace. The caller must already be allowed to create organizations. */
export async function createOrg(db: D1, userId: string, input: { name?: unknown; slug?: unknown; planId?: unknown }, now: number, mayPickPlan = false): Promise<Result<{ id: string; workspaceId: string }>> {
  const name = typeof input.name === "string" ? input.name.trim() : "";
  const slug = typeof input.slug === "string" ? input.slug.trim() : "";
  if (!name || name.length > 80) return fail(400, "Give the organization a name of up to 80 characters.");
  if (!SLUG.test(slug)) return fail(400, "The slug must be 1-48 lowercase letters, digits or dashes.");
  if (await first(db, "SELECT id FROM organizations WHERE slug = ?", slug)) return fail(409, "That slug is taken.");
  const id = newId("org");
  const ws = "default";
  const at = nowIso(now);
  // Only a platform admin may start an organization on a larger plan; everyone else gets Personal.
  const settings = JSON.stringify({ planId: mayPickPlan && isPlanId(input.planId) ? input.planId : "personal" });
  await db.batch([
    db.prepare("INSERT INTO organizations (id, name, slug, owner_user_id, status, settings, created_at, updated_at) VALUES (?, ?, ?, ?, 'active', ?, ?, ?)").bind(id, name, slug, userId, settings, at, at),
    db.prepare("INSERT INTO memberships (org_id, user_id, role, status, created_at, updated_at) VALUES (?, ?, 'owner', 'active', ?, ?)").bind(id, userId, at, at),
    db.prepare("INSERT INTO workspaces (org_id, id, name, created_at, updated_at) VALUES (?, ?, 'Default', ?, ?)").bind(id, ws, at, at),
    auditStatement(db, { orgId: id, actor: userId, action: "org.create", target: id, outcome: "allowed", detail: { slug } }, now),
  ]);
  return done({ id, workspaceId: ws });
}

export async function updateOrg(db: D1, a: Authorized, input: { name?: unknown }, now: number): Promise<Result<null>> {
  const name = typeof input.name === "string" ? input.name.trim() : "";
  if (!name || name.length > 80) return fail(400, "Give the organization a name of up to 80 characters.");
  await db.batch([
    db.prepare("UPDATE organizations SET name = ?, updated_at = ? WHERE id = ?").bind(name, nowIso(now), a.org.id),
    auditStatement(db, { orgId: a.org.id, actor: a.userId, action: "org.update", target: a.org.id, outcome: "allowed", detail: { name } }, now),
  ]);
  return done(null);
}

/**
 * Deleting is a soft delete (status 'deleted'): nothing is erased, and every member loses access at
 * once. Refused for the protected owner organization, without typing the slug, or while executions
 * are in flight.
 */
export async function deleteOrg(db: D1, a: Authorized, input: { confirmSlug?: unknown }, now: number): Promise<Result<null>> {
  if (a.org.protected) return fail(409, "This is the protected owner organization and can't be deleted.");
  if (input.confirmSlug !== a.org.slug) return fail(400, "Type the organization's slug to confirm.");
  const busy = await first<{ n: number }>(db, "SELECT COUNT(*) AS n FROM execution_leases WHERE org_id = ? AND expires_at > ?", a.org.id, nowIso(now));
  if ((busy?.n ?? 0) > 0) return fail(409, "Executions are still running. Wait for them to finish first.");
  await db.batch([
    db.prepare("UPDATE organizations SET status = 'deleted', updated_at = ? WHERE id = ?").bind(nowIso(now), a.org.id),
    auditStatement(db, { orgId: a.org.id, actor: a.userId, action: "org.delete", target: a.org.id, outcome: "allowed" }, now),
  ]);
  return done(null);
}

// ── Members ──────────────────────────────────────────────────────────────────

export async function listMembers(db: D1, a: Authorized) {
  const { results } = await db.prepare("SELECT user_id AS userId, role, status, created_at AS createdAt FROM memberships WHERE org_id = ? ORDER BY created_at").bind(a.org.id).all();
  return results;
}

const activeOwners = async (db: D1, orgId: string) => (await first<{ n: number }>(db, "SELECT COUNT(*) AS n FROM memberships WHERE org_id = ? AND role = 'owner' AND status = 'active'", orgId))?.n ?? 0;

/**
 * Adds, changes or removes a membership (nextRole null = remove). The user id is a Cloudflare Access
 * email: the person can only reach the site once the Access policy lets them in, so adding a member
 * here grants nothing outside Atlas and sends no invitation.
 */
export async function setMembership(db: D1, a: Authorized, targetUserId: unknown, nextRole: unknown, now: number): Promise<Result<null>> {
  const target = typeof targetUserId === "string" ? targetUserId.trim().toLowerCase() : "";
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(target)) return fail(400, "Give the member's sign-in email.");
  if (nextRole !== null && !isRole(nextRole)) return fail(400, "Role must be owner, admin, operator or viewer.");
  const current = await first<{ role: Role; status: string }>(db, "SELECT role, status FROM memberships WHERE org_id = ? AND user_id = ?", a.org.id, target);
  const targetRole = current?.status === "active" ? current.role : null;
  if (nextRole === null && !targetRole) return fail(404, "That person isn't a member.");
  const problem = roleChangeProblem({ actorUserId: a.userId, actorRole: a.role, targetUserId: target, targetRole, nextRole, activeOwners: await activeOwners(db, a.org.id) });
  if (problem) {
    await audit(db, { orgId: a.org.id, actor: a.userId, action: "member.change", target, outcome: "denied", detail: { from: targetRole, to: nextRole, reason: problem } }, now);
    return fail(403, problem);
  }
  if (!targetRole && nextRole) {
    const ent = effectiveEntitlement(settingsOf(a.org));
    const n = (await first<{ n: number }>(db, "SELECT COUNT(*) AS n FROM memberships WHERE org_id = ? AND status = 'active'", a.org.id))?.n ?? 0;
    if (n >= ent.maxUsers) return fail(409, `The ${ent.label} plan allows ${ent.maxUsers} member${ent.maxUsers === 1 ? "" : "s"}.`);
  }
  const at = nowIso(now);
  // The last-owner rule is enforced again inside the write itself: an owner row only changes while
  // another active owner exists, so two concurrent requests can't leave the organization with none.
  const keepsOwner = "(role != 'owner' OR (SELECT COUNT(*) FROM memberships WHERE org_id = ? AND role = 'owner' AND status = 'active') > 1 OR ? = 'owner')";
  const write = !targetRole
    ? db
        .prepare("INSERT INTO memberships (org_id, user_id, role, status, created_at, updated_at) VALUES (?, ?, ?, 'active', ?, ?) ON CONFLICT (org_id, user_id) DO UPDATE SET role = excluded.role, status = 'active', updated_at = excluded.updated_at")
        .bind(a.org.id, target, nextRole, at, at)
    : nextRole
      ? db.prepare(`UPDATE memberships SET role = ?, updated_at = ? WHERE org_id = ? AND user_id = ? AND status = 'active' AND ${keepsOwner}`).bind(nextRole, at, a.org.id, target, a.org.id, nextRole)
      : db.prepare(`UPDATE memberships SET status = 'removed', updated_at = ? WHERE org_id = ? AND user_id = ? AND status = 'active' AND ${keepsOwner}`).bind(at, a.org.id, target, a.org.id, "");
  if (changes(await write.run()) === 0) return fail(409, "This would leave the organization without an active owner.");
  await audit(db, { orgId: a.org.id, actor: a.userId, action: nextRole ? (targetRole ? "member.role" : "member.add") : "member.remove", target, outcome: "allowed", detail: { from: targetRole, to: nextRole } }, now);
  return done(null);
}

// ── Workspaces ───────────────────────────────────────────────────────────────

export async function listWorkspaces(db: D1, a: Authorized) {
  const { results } = await db.prepare("SELECT id, name, status, created_at AS createdAt FROM workspaces WHERE org_id = ? ORDER BY created_at").bind(a.org.id).all();
  return results;
}

export async function createWorkspace(db: D1, a: Authorized, input: { id?: unknown; name?: unknown }, now: number): Promise<Result<{ id: string }>> {
  const id = input.id === undefined ? newId("ws") : input.id;
  const name = typeof input.name === "string" ? input.name.trim() : "";
  if (!validId(id)) return fail(400, "Workspace id must be letters, digits, dots, dashes or colons.");
  if (!name || name.length > 80) return fail(400, "Give the workspace a name of up to 80 characters.");
  const ent = effectiveEntitlement(settingsOf(a.org));
  const n = (await first<{ n: number }>(db, "SELECT COUNT(*) AS n FROM workspaces WHERE org_id = ? AND status = 'active'", a.org.id))?.n ?? 0;
  if (n >= ent.maxWorkspaces) return fail(409, `The ${ent.label} plan allows ${ent.maxWorkspaces} workspace${ent.maxWorkspaces === 1 ? "" : "s"}.`);
  if (await first(db, "SELECT id FROM workspaces WHERE org_id = ? AND id = ?", a.org.id, id)) return fail(409, "That workspace id is already used here.");
  const at = nowIso(now);
  await db.batch([
    db.prepare("INSERT INTO workspaces (org_id, id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").bind(a.org.id, id, name, at, at),
    auditStatement(db, { orgId: a.org.id, actor: a.userId, action: "workspace.create", target: id, outcome: "allowed" }, now),
  ]);
  return done({ id });
}

// ── Resources ────────────────────────────────────────────────────────────────

export interface ResourceRow {
  kind: ResourceKind;
  id: string;
  workspace_id: string;
  template_id: string | null;
  body: string;
  version: number;
  created_at: string;
  updated_at: string;
}

export const publicResource = (r: ResourceRow) => ({ kind: r.kind, id: r.id, workspaceId: r.workspace_id, templateId: r.template_id, version: r.version, createdAt: r.created_at, updatedAt: r.updated_at, body: JSON.parse(r.body) });

export async function listResources(db: D1, a: Authorized, kind: ResourceKind, workspaceId?: string | null, limit = 200) {
  const { results } = workspaceId
    ? await db.prepare("SELECT * FROM resources WHERE org_id = ? AND kind = ? AND workspace_id = ? ORDER BY updated_at DESC LIMIT ?").bind(a.org.id, kind, workspaceId, limit).all<ResourceRow>()
    : await db.prepare("SELECT * FROM resources WHERE org_id = ? AND kind = ? ORDER BY updated_at DESC LIMIT ?").bind(a.org.id, kind, limit).all<ResourceRow>();
  return results.map(publicResource);
}

export const getResourceIn = (db: D1, orgId: string, kind: ResourceKind, id: string) => first<ResourceRow>(db, "SELECT * FROM resources WHERE org_id = ? AND kind = ? AND id = ?", orgId, kind, id);

export interface ResourceInput {
  workspaceId?: unknown;
  templateId?: unknown;
  body?: unknown;
  refs?: unknown;
  expectedVersion?: unknown;
}

/** Creates or replaces one record. Refuses a body that names another organization, holds a credential, or references a record this organization doesn't have. */
export async function putResource(db: D1, a: Authorized, kind: ResourceKind, id: string, input: ResourceInput, now: number): Promise<Result<{ version: number }>> {
  if (!validId(id)) return fail(400, "Record id must be letters, digits, dots, dashes or colons.");
  if (!input.body || typeof input.body !== "object" || Array.isArray(input.body)) return fail(400, "body must be a JSON object.");
  const body = input.body as Record<string, unknown>;
  for (const k of ["orgId", "organizationId", "org_id"]) {
    if (k in body && body[k] !== a.org.id) {
      await audit(db, { orgId: a.org.id, actor: a.userId, action: "resource.tenant_mismatch", target: `${kind}/${id}`, outcome: "denied" }, now);
      return fail(409, "The record names a different organization.");
    }
  }
  const text = JSON.stringify(body);
  if (text.length > MAX_BODY_BYTES) return fail(413, "Record too large (64 KB at most).");
  if (looksSecret(text)) return fail(422, "The record looks like it holds a credential. Store credentials as an integration instead.");
  if (!validId(input.workspaceId)) return fail(400, "workspaceId is required.");
  const ws = await first<{ status: string }>(db, "SELECT status FROM workspaces WHERE org_id = ? AND id = ?", a.org.id, input.workspaceId);
  if (!ws) return fail(422, "That workspace isn't in this organization.");
  const templateId = input.templateId === undefined || input.templateId === null ? null : input.templateId;
  if (templateId !== null) {
    if (kind !== "agent" || !validId(templateId)) return fail(400, "Only agents can name a template.");
    if (!(await first(db, "SELECT id FROM agent_templates WHERE id = ?", templateId))) return fail(422, "No such agent template.");
  }

  const explicit = Array.isArray(input.refs) ? input.refs : [];
  const refs: Ref[] = [...impliedRefs(kind, body)];
  for (const r of explicit) {
    const x = r as Partial<Ref>;
    if (!x || typeof x.rel !== "string" || !isKind(x.kind) || !validId(x.id)) return fail(400, "Each ref needs rel, kind and id.");
    refs.push({ rel: x.rel.slice(0, 40), kind: x.kind, id: x.id });
  }
  for (const r of refs) {
    if (r.kind === kind && r.id === id) continue;
    if (!(await getResourceIn(db, a.org.id, r.kind, r.id))) return fail(422, `It references ${r.kind} "${r.id}", which this organization doesn't have.`);
  }

  const existing = await getResourceIn(db, a.org.id, kind, id);
  if (input.expectedVersion !== undefined && (existing?.version ?? 0) !== input.expectedVersion) return fail(409, "Someone changed this record first. Reload and try again.");
  const at = nowIso(now);
  const version = (existing?.version ?? 0) + 1;
  const write = existing
    ? db.prepare("UPDATE resources SET workspace_id = ?, template_id = ?, body = ?, version = ?, updated_at = ? WHERE org_id = ? AND kind = ? AND id = ? AND version = ?").bind(input.workspaceId, templateId, text, version, at, a.org.id, kind, id, existing.version)
    : db.prepare("INSERT INTO resources (org_id, kind, id, workspace_id, template_id, body, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)").bind(a.org.id, kind, id, input.workspaceId, templateId, text, at, at);
  const r = await write.run();
  if (existing && changes(r) === 0) return fail(409, "Someone changed this record first. Reload and try again.");
  await db.batch([
    db.prepare("DELETE FROM resource_refs WHERE org_id = ? AND from_kind = ? AND from_id = ?").bind(a.org.id, kind, id),
    ...refs.map((x) => db.prepare("INSERT OR IGNORE INTO resource_refs (org_id, from_kind, from_id, rel, to_kind, to_id) VALUES (?, ?, ?, ?, ?, ?)").bind(a.org.id, kind, id, x.rel, x.kind, x.id)),
  ]);
  return done({ version });
}

export async function deleteResource(db: D1, a: Authorized, kind: ResourceKind, id: string, now: number): Promise<Result<null>> {
  const existing = await getResourceIn(db, a.org.id, kind, id);
  if (!existing) return fail(404, "No such record.");
  const used = await first<{ n: number }>(db, "SELECT COUNT(*) AS n FROM resource_refs WHERE org_id = ? AND to_kind = ? AND to_id = ?", a.org.id, kind, id);
  if ((used?.n ?? 0) > 0) return fail(409, "Other records still reference this one.");
  await db.batch([
    db.prepare("DELETE FROM resources WHERE org_id = ? AND kind = ? AND id = ?").bind(a.org.id, kind, id),
    auditStatement(db, { orgId: a.org.id, actor: a.userId, action: "resource.delete", target: `${kind}/${id}`, outcome: "allowed" }, now),
  ]);
  return done(null);
}

/** A person's approval on a task. The caller's membership and role were re-read for this request by authorize(). */
export async function decideApproval(db: D1, a: Authorized, taskId: string, input: { decision?: unknown; note?: unknown }, now: number): Promise<Result<{ version: number }>> {
  if (input.decision !== "granted" && input.decision !== "rejected") return fail(400, "decision must be granted or rejected.");
  const row = await getResourceIn(db, a.org.id, "task", taskId);
  if (!row) return fail(404, "No such task.");
  const body = JSON.parse(row.body) as Record<string, unknown>;
  const approvals = Array.isArray(body.approvals) ? body.approvals : [];
  const record = { decision: input.decision, by: a.userId, role: a.role, at: nowIso(now), note: typeof input.note === "string" ? input.note.slice(0, 500) : undefined };
  const next = JSON.stringify({ ...body, approvals: [...approvals, record] });
  const r = await db.prepare("UPDATE resources SET body = ?, version = version + 1, updated_at = ? WHERE org_id = ? AND kind = 'task' AND id = ? AND version = ?").bind(next, record.at, a.org.id, taskId, row.version).run();
  if (changes(r) === 0) return fail(409, "The task changed first. Reload and try again.");
  await audit(db, { orgId: a.org.id, actor: a.userId, action: "approval.decide", target: `task/${taskId}`, outcome: "allowed", detail: { decision: input.decision as string } }, now);
  return done({ version: row.version + 1 });
}

// ── Agent templates ──────────────────────────────────────────────────────────

export async function listTemplates(db: D1) {
  const { results } = await db.prepare("SELECT id, name, version, body FROM agent_templates ORDER BY name").all<{ id: string; name: string; version: number; body: string }>();
  return results.map((t) => ({ ...t, body: JSON.parse(t.body) }));
}

/** Platform admins only; the caller checks that. Organizations install a template by creating an agent that names it. */
export async function putTemplate(db: D1, actor: string, id: string, input: { name?: unknown; body?: unknown }, now: number): Promise<Result<null>> {
  if (!validId(id) || typeof input.name !== "string" || !input.body || typeof input.body !== "object") return fail(400, "Template needs an id, name and body.");
  const text = JSON.stringify(input.body);
  if (looksSecret(text)) return fail(422, "Templates can't hold credentials.");
  const at = nowIso(now);
  await db.batch([
    db.prepare("INSERT INTO agent_templates (id, name, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT (id) DO UPDATE SET name = excluded.name, body = excluded.body, version = agent_templates.version + 1, updated_at = excluded.updated_at").bind(id, input.name.slice(0, 80), text, at, at),
    auditStatement(db, { orgId: null, actor, action: "template.put", target: id, outcome: "allowed" }, now),
  ]);
  return done(null);
}
