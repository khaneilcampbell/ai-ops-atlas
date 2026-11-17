// The kinds of organization-owned records and the references their own fields imply. Shared by the
// server (which refuses references outside the organization) and the legacy import. No imports, so
// scripts/tenancy-import.mjs can load it directly.

export const RESOURCE_KINDS = ["project", "agent", "workflow", "task", "workflow_run", "memory", "artifact", "business_record", "customer_record"] as const;
export type ResourceKind = (typeof RESOURCE_KINDS)[number];
export const isKind = (v: unknown): v is ResourceKind => typeof v === "string" && (RESOURCE_KINDS as readonly string[]).includes(v);

export interface Ref {
  rel: string;
  kind: ResourceKind;
  id: string;
}

/** References a record's own fields imply, so a task can't point at another organization's agent or dependency. */
export function impliedRefs(kind: ResourceKind, body: Record<string, unknown>): Ref[] {
  const out: Ref[] = [];
  const one = (rel: string, k: ResourceKind, v: unknown) => {
    if (typeof v === "string" && v) out.push({ rel, kind: k, id: v });
  };
  if (kind === "task") {
    one("agent", "agent", body.agentId);
    one("workflow", "workflow", body.workflowId);
    one("project", "project", body.buildingId);
    one("parent", "task", body.parentTaskId);
    if (Array.isArray(body.dependencyIds)) for (const d of body.dependencyIds) one("depends_on", "task", d);
  }
  if (kind === "workflow_run") one("workflow", "workflow", body.definitionId);
  if (kind === "memory" && body.scope && typeof body.scope === "object") {
    const s = body.scope as Record<string, unknown>;
    if (s.project !== "global") one("project", "project", s.project);
    one("workflow", "workflow", s.workflowId);
  }
  return out;
}
