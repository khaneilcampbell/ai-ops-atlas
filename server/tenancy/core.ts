// Shared plumbing for the tenancy layer: the environment, identities, ids, the audit log and the
// one authorization check every protected operation goes through.
//
// Identity comes from Cloudflare Access (the site's existing sign-in), re-verified here from the
// signed token rather than trusted from a header. Membership and role are read from the database on
// every request, so a removed member or a lowered role takes effect on their very next request; no
// permission is ever cached in a session. An organization id in a URL only says which organization
// the caller is asking about. It is never proof of access.

import { verifyAccess, type AccessEnv } from "../access";
import type { D1 } from "../live";
import { can, isRole, type Action, type Role } from "../../src/tenancy/permissions";

export interface TenantEnv extends AccessEnv {
  /** D1 binding for the separate atlas-tenant database. Absent: every tenancy route answers 503. */
  TENANT?: D1;
  /** Must be "1" as well as TENANT being bound, so binding the database alone switches nothing on. */
  TENANCY_ENABLED?: string;
  /** Base64 of 32 random bytes. Encrypts organization integration credentials. */
  TENANT_VAULT_KEY?: string;
  /** Comma-separated emails that may create organizations and edit shared agent templates. */
  PLATFORM_ADMINS?: string;
  /** Comma-separated emails that may create organizations (besides platform admins). */
  ORG_CREATORS?: string;
  /** Bearer key the execution workers use for /api/hooks/tenant-callback and tenant-context. */
  TENANT_CALLBACK_TOKEN?: string;
}

export const tenancyOn = (env: TenantEnv): env is TenantEnv & { TENANT: D1 } => !!env.TENANT && env.TENANCY_ENABLED === "1";

export interface Identity {
  /** The verified Access email, lowercased. The tenancy layer's user id. */
  userId: string;
}

export type Identify = (req: Request, env: TenantEnv) => Promise<Identity | { status: number; reason: string }>;

/** The production identity source: the Cloudflare Access token, verified again here. */
export const accessIdentity: Identify = async (req, env) => {
  const r = await verifyAccess(req.headers.get("cf-access-jwt-assertion"), env);
  if (!r.ok) return { status: r.status, reason: r.reason };
  if (!r.email) return { status: 403, reason: "Your sign-in has no email, so Atlas can't match it to a membership." };
  return { userId: r.email };
};

const list = (s?: string) => (s ?? "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
export const isPlatformAdmin = (env: TenantEnv, userId: string) => list(env.PLATFORM_ADMINS).includes(userId);
export const mayCreateOrgs = (env: TenantEnv, userId: string) => isPlatformAdmin(env, userId) || list(env.ORG_CREATORS).includes(userId);

export const nowIso = (now: number) => new Date(now).toISOString();

export function newId(prefix: string): string {
  const b = crypto.getRandomValues(new Uint8Array(12));
  return `${prefix}_${[...b].map((x) => x.toString(16).padStart(2, "0")).join("")}`;
}

/** Rows changed by a statement, for both D1 ({meta:{changes}}) and node:sqlite ({changes}). */
export function changes(result: unknown): number {
  const r = result as { meta?: { changes?: number }; changes?: number | bigint } | null;
  return Number(r?.meta?.changes ?? r?.changes ?? 0);
}

export async function first<T>(db: D1, sql: string, ...args: unknown[]): Promise<T | null> {
  const { results } = await db.prepare(sql).bind(...args).all<T>();
  return results[0] ?? null;
}

// ── Audit ────────────────────────────────────────────────────────────────────

const SECRETISH = /(token|secret|password|key|credential|authorization)/i;

/** Drops anything that looks like a secret and caps sizes, so the audit log never holds one. */
export function redact(detail: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(detail)) {
    if (SECRETISH.test(k)) out[k] = "[redacted]";
    else if (typeof v === "string") out[k] = v.length > 200 ? `${v.slice(0, 200)}…` : v;
    else if (typeof v === "number" || typeof v === "boolean" || v === null) out[k] = v;
    else out[k] = "[object]";
  }
  return out;
}

export interface AuditInput {
  orgId: string | null;
  actor: string;
  action: string;
  target?: string | null;
  outcome: "allowed" | "denied" | "error";
  correlationId?: string | null;
  detail?: Record<string, unknown>;
}

export const auditStatement = (db: D1, e: AuditInput, now: number) =>
  db
    .prepare("INSERT INTO audit_events (id, org_id, at, actor, action, target, outcome, correlation_id, detail) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(newId("aud"), e.orgId, nowIso(now), e.actor, e.action, e.target ?? null, e.outcome, e.correlationId ?? null, JSON.stringify(redact(e.detail ?? {})));

export async function audit(db: D1, e: AuditInput, now: number): Promise<void> {
  await auditStatement(db, e, now).run();
  // One structured line for the platform logs too, with nothing private in it.
  console.log(JSON.stringify({ service: "tenancy", event: e.action, outcome: e.outcome, org: e.orgId, correlationId: e.correlationId ?? null }));
}

// ── Authorization ────────────────────────────────────────────────────────────

export interface OrgRow {
  id: string;
  name: string;
  slug: string;
  owner_user_id: string;
  status: "active" | "suspended" | "deleted";
  settings: string;
  protected: number;
  created_at: string;
  updated_at: string;
}

export interface Authorized {
  ok: true;
  org: OrgRow;
  role: Role;
  userId: string;
}
export type Denied = { ok: false; status: number; message: string };

/**
 * The single gate: is this verified user an active member of this active organization, with a role
 * that allows this action? Unknown organizations and non-members get the same 404, so the answer
 * never reveals whether another organization exists. Every refusal is audited.
 */
export async function authorize(db: D1, userId: string, orgId: string, action: Action, now: number): Promise<Authorized | Denied> {
  const row = await first<OrgRow & { role: string | null; m_status: string | null }>(
    db,
    "SELECT o.*, m.role AS role, m.status AS m_status FROM organizations o LEFT JOIN memberships m ON m.org_id = o.id AND m.user_id = ? WHERE o.id = ?",
    userId,
    orgId,
  );
  const deny = async (status: number, message: string, reason: string) => {
    await audit(db, { orgId: row ? orgId : null, actor: userId, action: `authz.${action}`, target: orgId, outcome: "denied", detail: { reason } }, now);
    return { ok: false as const, status, message };
  };
  if (!row || row.m_status !== "active" || !isRole(row.role)) return deny(404, "No such organization.", row ? "not_a_member" : "unknown_org");
  if (row.status === "deleted") return deny(404, "No such organization.", "org_deleted");
  if (row.status === "suspended" && action !== "org.read") return deny(403, "This organization is suspended.", "org_suspended");
  if (!can(row.role, action)) return deny(403, "Your role can't do that here.", `role_${row.role}`);
  const { role, m_status: _ms, ...org } = row;
  void _ms;
  return { ok: true, org: org as OrgRow, role: role as Role, userId };
}
