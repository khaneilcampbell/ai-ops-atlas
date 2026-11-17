// Organization roles and what each may do. Every authorization decision in the tenancy layer goes
// through `can` and the role-change rules below; nothing else compares role names. The matrix is
// plain data so it can be read, reviewed and tested in one place.

export const ROLES = ["owner", "admin", "operator", "viewer"] as const;
export type Role = (typeof ROLES)[number];

export const ACTIONS = [
  "org.read",
  "org.update",
  "org.delete",
  "member.read",
  "member.manage",
  "workspace.read",
  "workspace.manage",
  "resource.read",
  "resource.write",
  "resource.delete",
  "workflow.execute",
  "approval.decide",
  "integration.read",
  "integration.manage",
  "usage.read",
  "quota.override",
  "audit.read",
] as const;
export type Action = (typeof ACTIONS)[number];

const READ: Action[] = ["org.read", "member.read", "workspace.read", "resource.read", "integration.read", "usage.read"];
const OPERATE: Action[] = [...READ, "resource.write", "workflow.execute", "approval.decide"];
const ADMIN: Action[] = [...OPERATE, "org.update", "member.manage", "workspace.manage", "resource.delete", "integration.manage", "audit.read"];

export const MATRIX: Record<Role, ReadonlySet<Action>> = {
  owner: new Set<Action>([...ADMIN, "org.delete", "quota.override"]),
  admin: new Set<Action>(ADMIN),
  operator: new Set<Action>(OPERATE),
  viewer: new Set<Action>(READ),
};

export const isRole = (v: unknown): v is Role => typeof v === "string" && (ROLES as readonly string[]).includes(v);

export const can = (role: Role, action: Action): boolean => MATRIX[role]?.has(action) ?? false;

/** Higher number, more power. Used only for the role-change rules below. */
const RANK: Record<Role, number> = { viewer: 0, operator: 1, admin: 2, owner: 3 };

export interface RoleChange {
  actorUserId: string;
  actorRole: Role;
  targetUserId: string;
  /** The target's current role, or null when adding a new member. */
  targetRole: Role | null;
  /** The new role, or null when removing the member. */
  nextRole: Role | null;
  /** Active owners in the organization right now, including the target if they are one. */
  activeOwners: number;
}

/**
 * Whether a membership change is allowed. Refuses privilege escalation (nobody grants a role above
 * their own, only owners touch owners), changes to one's own role except an owner stepping down
 * while another owner remains, and anything that would leave the organization with no active owner.
 */
export function roleChangeProblem(c: RoleChange): string | null {
  if (!can(c.actorRole, "member.manage")) return "Your role can't change memberships.";
  const self = c.actorUserId === c.targetUserId;
  if (c.targetRole === "owner" || c.nextRole === "owner") {
    if (c.actorRole !== "owner") return "Only an owner can add, change or remove an owner.";
  }
  if (c.nextRole && RANK[c.nextRole] > RANK[c.actorRole]) return "You can't give a role above your own.";
  if (c.targetRole && RANK[c.targetRole] > RANK[c.actorRole]) return "You can't change someone whose role is above yours.";
  if (self && c.actorRole !== "owner") return "You can't change your own membership. Ask an owner.";
  const losesOwner = c.targetRole === "owner" && c.nextRole !== "owner";
  if (losesOwner && c.activeOwners <= 1) return "This is the last active owner. Add another owner first.";
  return null;
}
