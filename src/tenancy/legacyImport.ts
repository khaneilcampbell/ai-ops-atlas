// Moving the existing single-owner Atlas data into the owner organization.
//
// Today Atlas keeps Task Center tasks, workflow runs and their execution ledger, agent memory and
// business records only on the device (localStorage, see src/lib/backup.ts). This turns a device
// backup file (Settings > Data > Back up) into SQL for the separate tenant database:
//   - one protected owner organization, its owner membership and the workspace ids already in use;
//   - every record with its existing id, under that organization;
//   - every reference between them (task -> agent, building, workflow, dependency), creating a
//     clearly marked placeholder when a record points at an agent, building or workflow that only
//     exists in the catalog, so the Agent Registry and building associations are kept.
// Every statement is INSERT OR IGNORE, so running it twice changes nothing. Nothing is deleted
// anywhere, and the device keeps its own copy. `verificationSql` checks the result afterwards.
//
// No imports: scripts/tenancy-import.mjs loads this file and ./model directly.

import { impliedRefs, type Ref, type ResourceKind } from "./model";

export interface DeviceBackup {
  format: string;
  version: number;
  createdAt: string;
  entries: Record<string, string>;
}

export interface ImportOptions {
  orgId: string;
  slug: string;
  name: string;
  /** The owner's Cloudflare Access sign-in email. Never committed: passed in when the SQL is made. */
  ownerUserId: string;
  /** Used when the backup has no workspace of its own. */
  defaultWorkspaceId?: string;
  planId?: string;
  at: string;
}

export interface ImportRecord {
  kind: ResourceKind;
  id: string;
  workspaceId: string;
  body: Record<string, unknown>;
  placeholder?: boolean;
}

export interface ImportPlan {
  orgId: string;
  workspaces: { id: string; name: string }[];
  records: ImportRecord[];
  refs: (Ref & { fromKind: ResourceKind; fromId: string })[];
  /** Records per kind, for checking the database afterwards. */
  expected: Partial<Record<ResourceKind, number>>;
  /** Device storage keys left on the device (settings, caches) and why nothing was lost. */
  leftOnDevice: string[];
  warnings: string[];
}

type J = Record<string, unknown>;
const parse = (raw: string | undefined): J | null => {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw);
    return v && typeof v === "object" ? (v as J) : null;
  } catch {
    return null;
  }
};
const arr = (v: unknown): J[] => (Array.isArray(v) ? (v.filter((x) => x && typeof x === "object") as J[]) : []);
const str = (v: unknown) => (typeof v === "string" && v ? v : null);

const USED_KEYS = new Set(["product", "tasks", "workflow-runs", "workflow-exec", "agent-intel", "business"]);
const INTEL_COLLECTIONS = ["decisions", "evaluations", "feedback", "proposals", "versions", "contexts", "audit"];
const BUSINESS_COLLECTIONS = ["goals", "leads", "sales", "expenses", "products"];

export function planImport(backup: DeviceBackup, o: ImportOptions): ImportPlan {
  if (backup.format !== "atlas-device-backup") throw new Error("Not an Atlas device backup file.");
  const e = backup.entries ?? {};
  const warnings: string[] = [];
  const product = parse(e["product"]);
  const productWorkspaces = arr(product?.workspaces);
  const workspaces = productWorkspaces.length ? productWorkspaces.map((w) => ({ id: String(w.id), name: String(w.name ?? w.id) })) : [{ id: o.defaultWorkspaceId ?? "benjaire", name: "Benjaire" }];
  const ws = str(product?.activeId) ?? workspaces[0].id;

  const records = new Map<string, ImportRecord>();
  const key = (k: ResourceKind, id: string) => `${k}\u0000${id}`;
  const add = (r: ImportRecord) => {
    if (!records.has(key(r.kind, r.id))) records.set(key(r.kind, r.id), r);
  };

  // Buildings and agents the workspaces use, with their saved agent settings.
  for (const w of productWorkspaces) {
    const wid = String(w.id);
    for (const p of Array.isArray(w.projects) ? w.projects : []) if (str(p)) add({ kind: "project", id: p as string, workspaceId: wid, body: { buildingId: p, source: "workspace projects" } });
    const settings = (w.agentSettings && typeof w.agentSettings === "object" ? w.agentSettings : {}) as Record<string, J>;
    const agents = new Set<string>([...(Array.isArray(w.allowedAgents) ? (w.allowedAgents as string[]) : []), ...Object.keys(settings)]);
    for (const a of agents) if (str(a)) add({ kind: "agent", id: a, workspaceId: wid, body: { agentId: a, ...(settings[a] ?? {}), source: "workspace agents" } });
  }

  // Workflow definitions from the runs' frozen snapshots, then the runs with their execution ledger.
  const ledgers = new Map(arr(parse(e["workflow-exec"])?.runs).map((l) => [String(l.runId), l]));
  for (const run of arr(parse(e["workflow-runs"])?.runs)) {
    const snap = run.snapshot as J | undefined;
    if (snap && str(snap.id)) add({ kind: "workflow", id: snap.id as string, workspaceId: ws, body: { ...snap, source: "workflow run snapshot" } });
    if (str(run.id)) add({ kind: "workflow_run", id: run.id as string, workspaceId: ws, body: { ...run, ledger: ledgers.get(String(run.id)) ?? null } });
  }
  const runIds = new Set(arr(parse(e["workflow-runs"])?.runs).map((r) => String(r.id)));
  for (const [id, l] of ledgers) if (!runIds.has(id)) add({ kind: "workflow_run", id, workspaceId: ws, body: { id, ledgerOnly: true, ledger: l } });

  for (const t of arr(parse(e["tasks"])?.tasks)) if (str(t.id)) add({ kind: "task", id: t.id as string, workspaceId: ws, body: t });

  const intel = parse(e["agent-intel"]);
  for (const m of arr(intel?.memory)) if (str(m.id) && !m.seeded) add({ kind: "memory", id: m.id as string, workspaceId: ws, body: m });
  for (const c of INTEL_COLLECTIONS) for (const x of arr(intel?.[c])) if (str(x.id)) add({ kind: "artifact", id: `${c}:${x.id}`, workspaceId: ws, body: { collection: `agent-intel.${c}`, ...x } });

  const business = parse(e["business"]);
  for (const c of arr(business?.customers)) if (str(c.id)) add({ kind: "customer_record", id: c.id as string, workspaceId: ws, body: c });
  for (const col of BUSINESS_COLLECTIONS) for (const x of arr(business?.[col])) if (str(x.id)) add({ kind: "business_record", id: `${col}:${x.id}`, workspaceId: ws, body: { collection: col, originalId: x.id, ...x } });

  // References, with placeholders for catalog agents, buildings and workflows not in the backup.
  const refs: ImportPlan["refs"] = [];
  for (const r of [...records.values()]) {
    for (const ref of impliedRefs(r.kind, r.body)) {
      if (!records.has(key(ref.kind, ref.id))) {
        if (ref.kind === "task") {
          warnings.push(`${r.kind} "${r.id}" points at task "${ref.id}", which isn't in the backup; that link was left out.`);
          continue;
        }
        add({ kind: ref.kind, id: ref.id, workspaceId: r.workspaceId, placeholder: true, body: { placeholder: true, source: `referenced by ${r.kind} ${r.id}; defined in the Atlas catalog` } });
      }
      refs.push({ ...ref, fromKind: r.kind, fromId: r.id });
    }
  }

  const list = [...records.values()];
  const expected: ImportPlan["expected"] = {};
  for (const r of list) expected[r.kind] = (expected[r.kind] ?? 0) + 1;
  const leftOnDevice = Object.keys(e).filter((k) => !USED_KEYS.has(k)).sort();
  return { orgId: o.orgId, workspaces, records: list, refs, expected, leftOnDevice, warnings };
}

const q = (v: unknown) => (v === null || v === undefined ? "NULL" : typeof v === "number" ? String(v) : `'${String(v).replace(/'/g, "''")}'`);

/** The import as SQL for `wrangler d1 execute atlas-tenant --file=...`. Idempotent: INSERT OR IGNORE throughout. */
export function importSql(plan: ImportPlan, o: ImportOptions): string {
  const at = q(o.at);
  const lines = [
    `-- Atlas legacy import into organization ${o.orgId}. Generated ${o.at}. Idempotent; deletes nothing.`,
    "PRAGMA foreign_keys = ON;",
    `INSERT OR IGNORE INTO organizations (id, name, slug, owner_user_id, status, settings, protected, created_at, updated_at) VALUES (${q(o.orgId)}, ${q(o.name)}, ${q(o.slug)}, ${q(o.ownerUserId)}, 'active', ${q(JSON.stringify({ planId: o.planId ?? "enterprise", legacyImport: o.at }))}, 1, ${at}, ${at});`,
    `INSERT OR IGNORE INTO memberships (org_id, user_id, role, status, created_at, updated_at) VALUES (${q(o.orgId)}, ${q(o.ownerUserId)}, 'owner', 'active', ${at}, ${at});`,
    ...plan.workspaces.map((w) => `INSERT OR IGNORE INTO workspaces (org_id, id, name, created_at, updated_at) VALUES (${q(o.orgId)}, ${q(w.id)}, ${q(w.name)}, ${at}, ${at});`),
    ...plan.records.map((r) => `INSERT OR IGNORE INTO resources (org_id, kind, id, workspace_id, body, created_at, updated_at) VALUES (${q(o.orgId)}, ${q(r.kind)}, ${q(r.id)}, ${q(r.workspaceId)}, ${q(JSON.stringify(r.body))}, ${at}, ${at});`),
    ...plan.refs.map((x) => `INSERT OR IGNORE INTO resource_refs (org_id, from_kind, from_id, rel, to_kind, to_id) VALUES (${q(o.orgId)}, ${q(x.fromKind)}, ${q(x.fromId)}, ${q(x.rel)}, ${q(x.kind)}, ${q(x.id)});`),
    `INSERT OR IGNORE INTO audit_events (id, org_id, at, actor, action, target, outcome, detail) VALUES (${q(`aud_import_${o.at.replace(/\D/g, "")}`)}, ${q(o.orgId)}, ${at}, 'import', 'org.legacy_import', ${q(o.orgId)}, 'allowed', ${q(JSON.stringify({ records: plan.records.length, refs: plan.refs.length }))});`,
  ];
  return lines.join("\n") + "\n";
}

/** Queries whose answers must match `plan.expected` after the import. */
export function verificationSql(orgId: string): string {
  return [
    `SELECT kind, COUNT(*) AS n FROM resources WHERE org_id = ${q(orgId)} GROUP BY kind ORDER BY kind;`,
    `SELECT COUNT(*) AS dangling FROM resource_refs r LEFT JOIN resources t ON t.org_id = r.org_id AND t.kind = r.to_kind AND t.id = r.to_id WHERE r.org_id = ${q(orgId)} AND t.id IS NULL;`,
    `SELECT COUNT(*) AS orphans FROM resources r LEFT JOIN workspaces w ON w.org_id = r.org_id AND w.id = r.workspace_id WHERE r.org_id = ${q(orgId)} AND w.id IS NULL;`,
    "PRAGMA foreign_key_check;",
  ].join("\n");
}

/** Takes the imported organization back out of the tenant database. The device copy is untouched; audit events stay (append-only). */
export function rollbackSql(orgId: string): string {
  return [
    `DELETE FROM resource_refs WHERE org_id = ${q(orgId)};`,
    `DELETE FROM resources WHERE org_id = ${q(orgId)};`,
    `DELETE FROM workspaces WHERE org_id = ${q(orgId)};`,
    `DELETE FROM memberships WHERE org_id = ${q(orgId)};`,
    `DELETE FROM organizations WHERE id = ${q(orgId)};`,
  ].join("\n");
}
