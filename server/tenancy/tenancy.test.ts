import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it } from "vitest";
import type { D1, D1Statement } from "../live";
import { LocalTaskRepository, memoryBackend, TaskService } from "../../src/tasks/store";
import { KHANEIL } from "../../src/tasks/types";
import { can, MATRIX, roleChangeProblem } from "../../src/tenancy/permissions";
import { effectiveEntitlement, PLANS } from "../../src/tenancy/plans";
import { importSql, planImport, rollbackSql, verificationSql, type DeviceBackup } from "../../src/tenancy/legacyImport";
import { handleOrgs } from "./api";
import type { TenantEnv } from "./core";
import { agentContext, receiveCallback } from "./dispatch";
import { consume, recordUsage } from "./metering";
import { openCredential } from "./vault";

// Two isolated organizations with real identities (verified users) attempt to reach each other's
// data through the same API the site serves. Every test asserts the server refuses: these are not
// UI filters. The database is real SQLite with the production migration applied and foreign keys on,
// as D1 enforces them.

const UP = readFileSync(new URL("../../migrations/tenant/0001_tenancy.sql", import.meta.url), "utf8");
const DOWN = readFileSync(new URL("../../migrations/tenant/0001_tenancy.down.sql", import.meta.url), "utf8");

function sqlite() {
  const raw = new DatabaseSync(":memory:");
  raw.exec("PRAGMA foreign_keys = ON;");
  raw.exec(UP);
  const stmt = (sql: string, args: unknown[] = []): D1Statement => ({
    bind: (...a) => stmt(sql, a),
    run: async () => raw.prepare(sql).run(...(args as never[])),
    all: async <T,>() => ({ results: raw.prepare(sql).all(...(args as never[])) as T[] }),
  });
  const db: D1 = { prepare: (sql) => stmt(sql), batch: async (s) => { const out = []; for (const x of s) out.push(await x.run()); return out; } };
  return { raw, db };
}

const ALICE = "alice@org-a.test";
const BOB = "bob@org-b.test";
const CAROL = "carol@org-a.test";
const DAVE = "dave@org-a.test";
const MALLORY = "mallory@nowhere.test";
const CALLBACK = "k".repeat(40);
const VAULT = btoa(String.fromCharCode(...new Uint8Array(32).map((_, i) => i + 1)));
const T0 = Date.parse("2026-11-17T12:00:00Z");

let raw: DatabaseSync;
let env: TenantEnv & { TENANT: D1 };
let now = T0;

const call = async (user: string | null, method: string, path: string, body?: unknown) => {
  const req = new Request(`https://atlas.test/api/orgs${path}`, { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { "content-type": "application/json" } });
  const res = await handleOrgs(req, env, { identify: async () => (user ? { userId: user } : { status: 401, reason: "Sign in." }), now, checker: async () => ({ ok: true, detail: "connected" }) });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
};

let A: string;
let B: string;

async function seed(org: string, user: string, tag: string) {
  const put = (kind: string, id: string, body: Record<string, unknown>) => call(user, "PUT", `/${org}/resources/${kind}/${id}`, { workspaceId: "default", body });
  expect((await put("project", `bldg-${tag}`, { name: `Building ${tag}` })).status).toBe(200);
  expect((await put("agent", `agent-${tag}`, { name: `Agent ${tag}`, enabled: true })).status).toBe(200);
  expect((await put("workflow", `wf-${tag}`, { name: `Workflow ${tag}` })).status).toBe(200);
  expect((await put("task", `task-${tag}`, { title: "Do it", status: "queued", agentId: `agent-${tag}`, workflowId: `wf-${tag}`, buildingId: `bldg-${tag}`, dependencyIds: [] })).status).toBe(200);
  expect((await put("memory", `mem-${tag}`, { title: "Private note", content: `secret plan ${tag}`, scope: { project: `bldg-${tag}` } })).status).toBe(200);
  expect((await put("customer_record", `cust-${tag}`, { name: `Customer of ${tag}` })).status).toBe(200);
}

const dispatchBody = (tag: string, extra: Record<string, unknown> = {}) => ({ workspaceId: "default", workflowId: `wf-${tag}`, runId: `run-${tag}`, taskId: `task-${tag}`, agentId: `agent-${tag}`, ...extra });

beforeEach(async () => {
  const s = sqlite();
  raw = s.raw;
  env = { TENANT: s.db, TENANCY_ENABLED: "1", ORG_CREATORS: `${ALICE},${BOB}`, TENANT_VAULT_KEY: VAULT, TENANT_CALLBACK_TOKEN: CALLBACK, PLATFORM_ADMINS: "platform@atlas.test" };
  now = T0;
  const a = await call(ALICE, "POST", "", { name: "Org A", slug: "org-a" });
  const b = await call(BOB, "POST", "", { name: "Org B", slug: "org-b" });
  expect(a.status).toBe(201);
  expect(b.status).toBe(201);
  A = a.body.id;
  B = b.body.id;
  // Room for a few members, but one execution at a time so the concurrency limit is easy to hit.
  raw.prepare("UPDATE organizations SET settings = ?").run(JSON.stringify({ planId: "professional", quotaOverrides: { concurrent_executions: 1 } }));
  await seed(A, ALICE, "a");
  await seed(B, BOB, "b");
});

describe("permission matrix and plans", () => {
  it("gives each role exactly its actions", () => {
    expect(can("viewer", "resource.read")).toBe(true);
    expect(can("viewer", "resource.write")).toBe(false);
    expect(can("operator", "workflow.execute")).toBe(true);
    expect(can("operator", "member.manage")).toBe(false);
    expect(can("admin", "member.manage")).toBe(true);
    expect(can("admin", "org.delete")).toBe(false);
    expect(can("admin", "quota.override")).toBe(false);
    expect([...MATRIX.owner].length).toBeGreaterThan([...MATRIX.admin].length);
  });
  it("refuses privilege escalation and losing the last owner", () => {
    const base = { actorUserId: "x", targetUserId: "y", activeOwners: 1 };
    expect(roleChangeProblem({ ...base, actorRole: "admin", targetRole: "viewer", nextRole: "owner" })).toMatch(/owner/);
    expect(roleChangeProblem({ ...base, actorRole: "admin", targetRole: null, nextRole: "admin" })).toBeNull();
    expect(roleChangeProblem({ ...base, actorRole: "operator", targetRole: "viewer", nextRole: "operator" })).toMatch(/can't change memberships/);
    expect(roleChangeProblem({ ...base, actorUserId: "y", actorRole: "admin", targetRole: "admin", nextRole: "owner" })).toMatch(/owner/);
    expect(roleChangeProblem({ ...base, actorUserId: "y", actorRole: "owner", targetRole: "owner", nextRole: null })).toMatch(/last active owner/);
    expect(roleChangeProblem({ ...base, activeOwners: 2, actorUserId: "y", actorRole: "owner", targetRole: "owner", nextRole: "admin" })).toBeNull();
  });
  it("keeps plans unpriced and not for sale, and applies owner overrides", () => {
    for (const p of Object.values(PLANS)) {
      expect(p.commerciallyAvailable).toBe(false);
      expect(JSON.stringify(p)).not.toMatch(/price|\$/i);
    }
    expect(effectiveEntitlement({ planId: "personal", quotaOverrides: { daily_tasks: 7, bogus: 3 } }).limits.daily_tasks).toBe(7);
    expect(effectiveEntitlement({ planId: "nope" }).id).toBe("personal");
  });
});

describe("1-3 organizations, membership and switching", () => {
  it("lets only authorized users create organizations", async () => {
    expect((await call(MALLORY, "POST", "", { name: "Evil", slug: "evil" })).status).toBe(403);
    expect((await call(null, "GET", "")).status).toBe(401);
    expect((await call(ALICE, "POST", "", { name: "Dup", slug: "org-b" })).status).toBe(409);
  });
  it("lists only the caller's own organizations and hides the rest behind 404", async () => {
    const mine = await call(ALICE, "GET", "");
    expect(mine.body.orgs.map((o: { id: string }) => o.id)).toEqual([A]);
    expect((await call(ALICE, "GET", `/${B}`)).status).toBe(404);
    expect((await call(BOB, "GET", `/${A}/members`)).status).toBe(404);
    expect((await call(MALLORY, "GET", `/${A}`)).status).toBe(404);
  });
  it("applies a removed member's loss of access on their very next request", async () => {
    expect((await call(ALICE, "POST", `/${A}/members`, { userId: CAROL, role: "operator" })).status).toBe(201);
    expect((await call(CAROL, "GET", `/${A}/resources/task/task-a`)).status).toBe(200);
    expect((await call(ALICE, "DELETE", `/${A}/members/${CAROL}`)).status).toBe(200);
    expect((await call(CAROL, "GET", `/${A}/resources/task/task-a`)).status).toBe(404);
  });
  it("enforces each role's limits through the API", async () => {
    await call(ALICE, "POST", `/${A}/members`, { userId: CAROL, role: "viewer" });
    expect((await call(CAROL, "GET", `/${A}/resources/task`)).status).toBe(200);
    expect((await call(CAROL, "PUT", `/${A}/resources/task/t2`, { workspaceId: "default", body: { title: "x" } })).status).toBe(403);
    expect((await call(CAROL, "POST", `/${A}/dispatch`, dispatchBody("a"))).status).toBe(403);
    expect((await call(CAROL, "GET", `/${A}/audit`)).status).toBe(403);
  });
});

describe("4-5 cross-tenant reads and writes are refused", () => {
  it("refuses reading another organization's records, by its path or by its ids under your own", async () => {
    expect((await call(BOB, "GET", `/${A}/resources/task/task-a`)).status).toBe(404);
    expect((await call(BOB, "GET", `/${A}/resources/memory`)).status).toBe(404);
    expect((await call(BOB, "GET", `/${B}/resources/task/task-a`)).status).toBe(404);
    expect((await call(BOB, "GET", `/${B}/resources/customer_record/cust-a`)).status).toBe(404);
    const list = await call(BOB, "GET", `/${B}/resources/memory`);
    expect(JSON.stringify(list.body)).not.toContain("secret plan a");
  });
  it("refuses writing, deleting and approving in another organization", async () => {
    expect((await call(BOB, "PUT", `/${A}/resources/task/task-a`, { workspaceId: "default", body: { title: "pwned" } })).status).toBe(404);
    expect((await call(BOB, "DELETE", `/${A}/resources/customer_record/cust-a`)).status).toBe(404);
    expect((await call(BOB, "POST", `/${A}/approvals/task-a`, { decision: "granted" })).status).toBe(404);
    expect((await call(BOB, "DELETE", `/${B}/resources/customer_record/cust-a`)).status).toBe(404);
    const still = await call(ALICE, "GET", `/${A}/resources/task/task-a`);
    expect(still.body.body.title).toBe("Do it");
  });
  it("refuses references to another organization's records and mismatched organization ids", async () => {
    const r = await call(BOB, "PUT", `/${B}/resources/task/sneaky`, { workspaceId: "default", body: { title: "x", agentId: "agent-a", dependencyIds: [] } });
    expect(r.status).toBe(422);
    const d = await call(BOB, "PUT", `/${B}/resources/task/sneaky`, { workspaceId: "default", body: { title: "x", dependencyIds: ["task-a"] } });
    expect(d.status).toBe(422);
    const m = await call(BOB, "PUT", `/${B}/resources/task/sneaky`, { workspaceId: "default", body: { title: "x", orgId: A } });
    expect(m.status).toBe(409);
  });
  it("is enforced by the database too: a cross-organization reference can't be stored", () => {
    expect(() => raw.prepare("INSERT INTO resource_refs (org_id, from_kind, from_id, rel, to_kind, to_id) VALUES (?, 'task', 'task-b', 'agent', 'agent', 'agent-a')").run(B)).toThrow(/FOREIGN KEY/);
  });
  it("refuses credentials stored in ordinary records", async () => {
    const r = await call(ALICE, "PUT", `/${A}/resources/artifact/leak`, { workspaceId: "default", body: { note: "ghp_" + "a".repeat(36) } });
    expect(r.status).toBe(422);
  });
});

describe("6 cross-tenant execution, 9 callbacks, 7 memory isolation", () => {
  it("refuses dispatching another organization's workflow, task or agent", async () => {
    expect((await call(BOB, "POST", `/${A}/dispatch`, dispatchBody("a"))).status).toBe(404);
    expect((await call(BOB, "POST", `/${B}/dispatch`, dispatchBody("a"))).status).toBe(422);
    expect((await call(BOB, "POST", `/${B}/dispatch`, dispatchBody("b", { agentId: "agent-a" }))).status).toBe(422);
    expect((await call(BOB, "POST", `/${B}/dispatch`, dispatchBody("b", { taskId: "task-a" }))).status).toBe(422);
  });
  it("carries trusted tenant context and authenticates callbacks per dispatch", async () => {
    const ok = await call(BOB, "POST", `/${B}/dispatch`, dispatchBody("b", { correlationId: "corr-1" }));
    expect(ok.status).toBe(201);
    const env1 = ok.body;
    expect(env1).toMatchObject({ orgId: B, workspaceId: "default", taskId: "task-b", agentId: "agent-b", correlationId: "corr-1", attempt: 1 });
    const cb = (headers: Record<string, string>, body: Record<string, unknown>) => receiveCallback(env.TENANT, env, new Request("https://atlas.test/api/hooks/tenant-callback", { method: "POST", headers, body: JSON.stringify(body) }), now + 5000);
    expect((await cb({ authorization: "Bearer wrong" }, { dispatchId: env1.dispatchId, state: "succeeded" })).status).toBe(401);
    expect((await cb({ authorization: `Bearer ${CALLBACK}`, "x-atlas-dispatch-key": "guess" }, { dispatchId: env1.dispatchId, state: "succeeded" })).status).toBe(404);
    const good = { authorization: `Bearer ${CALLBACK}`, "x-atlas-dispatch-key": env1.callbackKey };
    expect((await cb(good, { dispatchId: env1.dispatchId, state: "succeeded", orgId: A })).status).toBe(409);
    const usage = [{ resourceType: "model_input_tokens", quantity: 1200, unit: "token", measurement: "metered", dedupKey: "msg-1", providerRef: "msg_1" }];
    const first = await cb(good, { dispatchId: env1.dispatchId, state: "succeeded", usage });
    expect(await first.json()).toMatchObject({ stored: true, usageAdded: 2 });
    const replay = await cb(good, { dispatchId: env1.dispatchId, state: "succeeded", usage });
    expect(await replay.json()).toMatchObject({ duplicate: true });
    const u = await call(BOB, "GET", `/${B}/usage?period=2026-11`);
    const tokens = u.body.rows.find((r: { resourceType: string }) => r.resourceType === "model_input_tokens");
    expect(tokens).toMatchObject({ total: 1200, measurement: "metered", events: 1 });
    expect((await call(ALICE, "GET", `/${A}/usage?period=2026-11`)).body.rows.find((r: { resourceType: string }) => r.resourceType === "model_input_tokens")).toBeUndefined();
  });
  it("retries keep the original tenant context", async () => {
    const d = (await call(BOB, "POST", `/${B}/dispatch`, dispatchBody("b", { correlationId: "corr-r" }))).body;
    await receiveCallback(env.TENANT, env, new Request("https://atlas.test/x", { method: "POST", headers: { authorization: `Bearer ${CALLBACK}`, "x-atlas-dispatch-key": d.callbackKey }, body: JSON.stringify({ dispatchId: d.dispatchId, state: "failed" }) }), now);
    expect((await call(ALICE, "POST", `/${A}/dispatch/${d.dispatchId}/retry`)).status).toBe(404);
    const r = await call(BOB, "POST", `/${B}/dispatch/${d.dispatchId}/retry`);
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ orgId: B, taskId: "task-b", correlationId: "corr-r", attempt: 2 });
  });
  it("lets an agent read only its own organization's and workspace's memory while it runs", async () => {
    const d = (await call(BOB, "POST", `/${B}/dispatch`, dispatchBody("b"))).body;
    const read = (kind: string, id: string, key = d.callbackKey) => agentContext(env.TENANT, env, new Request(`https://atlas.test/api/hooks/tenant-context?dispatch=${d.dispatchId}&kind=${kind}&id=${id}`, { headers: { authorization: `Bearer ${CALLBACK}`, "x-atlas-dispatch-key": key } }), now);
    expect((await read("memory", "mem-b")).status).toBe(200);
    expect((await read("memory", "mem-a")).status).toBe(404);
    expect((await read("task", "task-a")).status).toBe(404);
    expect((await read("memory", "mem-b", "stolen")).status).toBe(404);
    await call(BOB, "POST", `/${B}/workspaces`, { id: "other", name: "Other" });
    expect((await read("memory", "mem-b")).status).toBe(200);
  });
  it("re-checks approvals and the approver's current membership", async () => {
    await call(ALICE, "PUT", `/${A}/resources/task/gated`, { workspaceId: "default", body: { title: "Gated", status: "queued", agentId: "agent-a", workflowId: "wf-a", requiresApproval: true, dependencyIds: [] } });
    expect((await call(ALICE, "POST", `/${A}/dispatch`, dispatchBody("a", { taskId: "gated" }))).status).toBe(409);
    await call(ALICE, "POST", `/${A}/members`, { userId: CAROL, role: "operator" });
    await call(ALICE, "DELETE", `/${A}/members/${CAROL}`);
    expect((await call(CAROL, "POST", `/${A}/approvals/gated`, { decision: "granted" })).status).toBe(404);
    expect((await call(ALICE, "POST", `/${A}/approvals/gated`, { decision: "granted" })).status).toBe(200);
    expect((await call(ALICE, "POST", `/${A}/dispatch`, dispatchBody("a", { taskId: "gated" }))).status).toBe(201);
  });
});

describe("8 integration credentials", () => {
  it("encrypts per organization, never returns the secret, and isolates access", async () => {
    const add = await call(ALICE, "POST", `/${A}/integrations`, { provider: "github", label: "GitHub", scopes: ["contents:read"], secret: "gh-test-credential-123" });
    expect(add.status).toBe(201);
    const listA = await call(ALICE, "GET", `/${A}/integrations`);
    expect(JSON.stringify(listA.body)).not.toContain("gh-test-credential-123");
    expect(listA.body.integrations[0].credential).toMatch(/^set \(…[0-9a-f]{8}\)$/);
    expect((await call(BOB, "GET", `/${B}/integrations`)).body.integrations).toEqual([]);
    expect((await call(BOB, "POST", `/${B}/integrations/${add.body.id}/rotate`, { secret: "new-secret-value" })).status).toBe(404);
    expect((await call(BOB, "POST", `/${A}/integrations/${add.body.id}/revoke`)).status).toBe(404);
    expect(await openCredential(env.TENANT, env, A, add.body.id)).toBe("gh-test-credential-123");
    expect(await openCredential(env.TENANT, env, B, add.body.id)).toBeNull();
    // A ciphertext copied into the other organization's row does not decrypt.
    raw.prepare("INSERT INTO org_integrations (org_id, id, provider, label, scopes, ciphertext, iv, key_version, fingerprint, status, created_at, updated_at) SELECT ?, id, provider, label, scopes, ciphertext, iv, key_version, fingerprint, status, created_at, updated_at FROM org_integrations WHERE org_id = ?").run(B, A);
    expect(await openCredential(env.TENANT, env, B, add.body.id)).toBeNull();
  });
  it("refuses over-broad scopes, and revoking erases the ciphertext", async () => {
    expect((await call(ALICE, "POST", `/${A}/integrations`, { provider: "github", scopes: ["admin:org"], secret: "abcdefgh123" })).status).toBe(400);
    const add = await call(ALICE, "POST", `/${A}/integrations`, { provider: "n8n", scopes: ["workflow:read"], secret: "n8n-test-key-1" });
    expect((await call(ALICE, "POST", `/${A}/integrations/${add.body.id}/check`)).body).toMatchObject({ ok: true });
    expect((await call(ALICE, "POST", `/${A}/integrations/${add.body.id}/revoke`)).status).toBe(200);
    expect(await openCredential(env.TENANT, env, A, add.body.id)).toBeNull();
    expect(raw.prepare("SELECT ciphertext FROM org_integrations WHERE id = ?").get(add.body.id)).toMatchObject({ ciphertext: null });
  });
});

describe("10 quotas, 11 usage deduplication", () => {
  it("enforces the concurrent execution limit and frees the slot on callback", async () => {
    const first = await call(BOB, "POST", `/${B}/dispatch`, dispatchBody("b"));
    expect(first.status).toBe(201);
    const second = await call(BOB, "POST", `/${B}/dispatch`, dispatchBody("b"));
    expect(second.status).toBe(429);
    await receiveCallback(env.TENANT, env, new Request("https://atlas.test/x", { method: "POST", headers: { authorization: `Bearer ${CALLBACK}`, "x-atlas-dispatch-key": first.body.callbackKey }, body: JSON.stringify({ dispatchId: first.body.dispatchId, state: "succeeded" }) }), now);
    expect((await call(BOB, "POST", `/${B}/dispatch`, dispatchBody("b"))).status).toBe(201);
  });
  it("enforces daily task limits atomically, warns first, and only owners override", async () => {
    await call(ALICE, "POST", `/${A}/members`, { userId: DAVE, role: "admin" });
    expect((await call(DAVE, "PUT", `/${A}/quotas`, { metric: "daily_tasks", value: 9999 })).status).toBe(403);
    expect((await call(ALICE, "PUT", `/${A}/quotas`, { metric: "daily_tasks", value: 5 })).status).toBe(200);
    const org = raw.prepare("SELECT id, settings FROM organizations WHERE id = ?").get(A) as { id: string; settings: string };
    const answers = await Promise.all(Array.from({ length: 8 }, () => consume(env.TENANT, org, "daily_tasks", 1, now)));
    expect(answers.filter((x) => x.ok)).toHaveLength(5);
    expect(answers.filter((x) => !x.ok)).toHaveLength(3);
    const q = await call(ALICE, "GET", `/${A}/quotas`);
    expect(q.body.quotas.find((x: { metric: string }) => x.metric === "daily_tasks")).toMatchObject({ used: 5, limit: 5, level: "exceeded" });
    const audit = await call(ALICE, "GET", `/${A}/audit`);
    const actions = audit.body.events.map((e: { action: string }) => e.action);
    expect(actions).toContain("quota.warning");
    expect(actions).toContain("quota.exceeded");
    expect(actions).toContain("quota.override");
  });
  it("counts each usage event once and keeps usage append-only", async () => {
    const e = { resourceType: "model_request" as const, quantity: 1, unit: "request", measurement: "metered" as const, dedupKey: "req-1" };
    expect(await recordUsage(env.TENANT, A, [e, e], now)).toBe(1);
    expect(await recordUsage(env.TENANT, A, [e], now)).toBe(0);
    expect(await recordUsage(env.TENANT, B, [e], now)).toBe(1);
    expect(await recordUsage(env.TENANT, A, [{ ...e, resourceType: "estimated_cost_usd_micros", measurement: "metered", dedupKey: "c" }], now)).toBe(0);
    expect(() => raw.exec("UPDATE usage_events SET quantity = 0")).toThrow(/append-only/);
    expect(() => raw.exec("DELETE FROM audit_events")).toThrow(/append-only/);
  });
});

describe("13 deletion safeguards, 14 role escalation", () => {
  it("refuses unsafe deletes and cuts every member off after a delete", async () => {
    await call(ALICE, "POST", `/${A}/members`, { userId: DAVE, role: "admin" });
    expect((await call(DAVE, "POST", `/${A}/delete`, { confirmSlug: "org-a" })).status).toBe(403);
    expect((await call(ALICE, "POST", `/${A}/delete`, { confirmSlug: "wrong" })).status).toBe(400);
    const d = await call(ALICE, "POST", `/${A}/dispatch`, dispatchBody("a"));
    expect(d.status).toBe(201);
    expect((await call(ALICE, "POST", `/${A}/delete`, { confirmSlug: "org-a" })).status).toBe(409);
    now += 3_600_000;
    expect((await call(ALICE, "POST", `/${A}/delete`, { confirmSlug: "org-a" })).status).toBe(200);
    expect((await call(DAVE, "GET", `/${A}`)).status).toBe(404);
    expect(raw.prepare("SELECT COUNT(*) AS n FROM resources WHERE org_id = ?").get(A)).toMatchObject({ n: 6 });
  });
  it("never lets a protected owner organization be deleted", async () => {
    raw.prepare("UPDATE organizations SET protected = 1 WHERE id = ?").run(A);
    expect((await call(ALICE, "POST", `/${A}/delete`, { confirmSlug: "org-a" })).status).toBe(409);
  });
  it("refuses privilege escalation through the API", async () => {
    await call(ALICE, "POST", `/${A}/members`, { userId: DAVE, role: "admin" });
    await call(ALICE, "POST", `/${A}/members`, { userId: CAROL, role: "operator" });
    expect((await call(CAROL, "PATCH", `/${A}/members/${CAROL}`, { role: "admin" })).status).toBe(403);
    expect((await call(DAVE, "PATCH", `/${A}/members/${DAVE}`, { role: "owner" })).status).toBe(403);
    expect((await call(DAVE, "POST", `/${A}/members`, { userId: MALLORY, role: "owner" })).status).toBe(403);
    expect((await call(DAVE, "PATCH", `/${A}/members/${ALICE}`, { role: "viewer" })).status).toBe(403);
    expect((await call(ALICE, "DELETE", `/${A}/members/${ALICE}`)).status).toBe(403);
    expect((await call(ALICE, "PATCH", `/${A}/members/${ALICE}`, { role: "admin" })).status).toBe(403);
    expect((await call(BOB, "POST", `/${A}/members`, { userId: BOB, role: "owner" })).status).toBe(404);
    const audit = await call(ALICE, "GET", `/${A}/audit`);
    expect(audit.body.events.filter((e: { outcome: string }) => e.outcome === "denied").length).toBeGreaterThan(3);
  });
  it("lets an owner step down only once another owner exists", async () => {
    await call(ALICE, "POST", `/${A}/members`, { userId: CAROL, role: "owner" });
    expect((await call(ALICE, "PATCH", `/${A}/members/${ALICE}`, { role: "admin" })).status).toBe(200);
    expect((await call(CAROL, "DELETE", `/${A}/members/${CAROL}`)).status).toBe(403);
  });
  it("keeps shared agent templates read-only for organizations", async () => {
    expect((await call(ALICE, "PUT", "/templates/research", { name: "Research", body: { prompt: "x" } })).status).toBe(403);
    expect((await call("platform@atlas.test", "PUT", "/templates/research", { name: "Research", body: { prompt: "x" } })).status).toBe(200);
    expect((await call(BOB, "PUT", `/${B}/resources/agent/installed`, { workspaceId: "default", templateId: "research", body: { enabled: true } })).status).toBe(200);
    expect((await call(BOB, "PUT", `/${B}/resources/task/t`, { workspaceId: "default", templateId: "research", body: {} })).status).toBe(400);
  });
});

describe("12 existing data migration, 15 legacy compatibility, 16 Task Center integration", () => {
  function deviceBackup(): DeviceBackup {
    const repo = new LocalTaskRepository(memoryBackend());
    const svc = new TaskService(repo, () => "2026-11-16T10:00:00.000Z");
    const t1 = svc.create({ title: "Research idea", agentId: "research-agent", buildingId: "benjaire-hq", workflow: { kind: "n8n", id: "step-runner", name: "Step Runner" } as never }, KHANEIL);
    expect(t1.ok).toBe(true);
    const t1id = repo.list()[0].id;
    svc.create({ title: "Plan it", agentId: "planner", buildingId: "benjaire-hq", dependencyIds: [t1id] }, KHANEIL);
    const tasks = JSON.stringify({ version: 1, tasks: repo.list() });
    return {
      format: "atlas-device-backup",
      version: 1,
      createdAt: "2026-11-16T10:00:00.000Z",
      entries: {
        product: JSON.stringify({ version: 1, activeId: "benjaire", workspaces: [{ id: "benjaire", name: "Benjaire", projects: ["benjaire-hq", "portfolio-site"], allowedAgents: ["research-agent", "planner"], agentSettings: { planner: { enabled: true, maxModelTier: 1 } } }] }),
        tasks,
        "workflow-runs": JSON.stringify({ version: 1, runs: [{ id: "wfrun_1", definitionId: "launch", snapshot: { id: "launch", version: 2, name: "Launch", nodes: [] }, nodeTasks: { n1: t1id } }] }),
        "workflow-exec": JSON.stringify({ version: 1, runs: [{ runId: "wfrun_1", rev: 4, handoffs: {}, dispatched: ["k1"] }] }),
        "agent-intel": JSON.stringify({ version: 1, rev: 1, memory: [{ id: "m1", title: "Pricing", content: "Keep it simple", scope: { project: "benjaire-hq" } }, { id: "seed-1", seeded: true, scope: { project: "global" } }], decisions: [{ id: "d1", what: "x" }] }),
        business: JSON.stringify({ version: 1, customers: [{ id: "c1", name: "Acme" }], sales: [{ id: "s1", amount: 100 }], goals: [], leads: [], expenses: [], products: [] }),
        timeZone: "\"America/New_York\"",
      },
    };
  }

  it("imports every record with its id, keeps registry and building links, and verifies cleanly", async () => {
    const backup = deviceBackup();
    const opts = { orgId: "org_benjaire", slug: "benjaire", name: "Benjaire", ownerUserId: "owner@benjaire.test", at: "2026-11-17T00:00:00.000Z" };
    const plan = planImport(backup, opts);
    const sql = importSql(plan, opts);
    raw.exec(sql);
    raw.exec(sql); // idempotent
    const counts = Object.fromEntries((raw.prepare("SELECT kind, COUNT(*) AS n FROM resources WHERE org_id = 'org_benjaire' GROUP BY kind").all() as { kind: string; n: number }[]).map((r) => [r.kind, r.n]));
    expect(counts).toEqual(plan.expected);
    expect(counts).toMatchObject({ task: 2, workflow_run: 1, memory: 1, customer_record: 1, business_record: 1, artifact: 1, project: 2 });
    const [q1, q2, q3] = verificationSql("org_benjaire").split("\n");
    void q1;
    expect(raw.prepare(q2).get()).toMatchObject({ dangling: 0 });
    expect(raw.prepare(q3).get()).toMatchObject({ orphans: 0 });
    expect(raw.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    const tasks = JSON.parse(backup.entries.tasks).tasks as { id: string }[];
    for (const t of tasks) expect(raw.prepare("SELECT id FROM resources WHERE org_id = 'org_benjaire' AND kind = 'task' AND id = ?").get(t.id)).toBeTruthy();
    const links = raw.prepare("SELECT rel, to_kind, to_id FROM resource_refs WHERE org_id = 'org_benjaire' AND from_id = ? ORDER BY rel").all(tasks[1].id);
    expect(links).toEqual([
      { rel: "agent", to_kind: "agent", to_id: "planner" },
      { rel: "depends_on", to_kind: "task", to_id: tasks[0].id },
      { rel: "project", to_kind: "project", to_id: "benjaire-hq" },
    ]);
    const run = raw.prepare("SELECT body FROM resources WHERE org_id = 'org_benjaire' AND kind = 'workflow_run' AND id = 'wfrun_1'").get() as { body: string };
    expect(JSON.parse(run.body).ledger).toMatchObject({ runId: "wfrun_1", rev: 4, dispatched: ["k1"] });
    expect(plan.leftOnDevice).toEqual(["timeZone"]);
    // The imported owner sees it through the same API, and the other organizations still can't.
    expect((await call("owner@benjaire.test", "GET", "/org_benjaire/resources/task")).body.items).toHaveLength(2);
    expect((await call(BOB, "GET", "/org_benjaire/resources/task")).status).toBe(404);
    expect((await call("owner@benjaire.test", "POST", "/org_benjaire/delete", { confirmSlug: "benjaire" })).status).toBe(409);
    raw.exec(rollbackSql("org_benjaire"));
    expect(raw.prepare("SELECT COUNT(*) AS n FROM resources WHERE org_id = 'org_benjaire'").get()).toMatchObject({ n: 0 });
    expect(raw.prepare("SELECT COUNT(*) AS n FROM resources WHERE org_id = ?").get(A)).toMatchObject({ n: 6 });
  });

  it("rolls the schema back completely", () => {
    raw.exec(DOWN);
    expect(raw.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type IN ('table', 'trigger')").get()).toMatchObject({ n: 0 });
  });

  it("changes nothing for the single-owner site until tenancy is switched on", async () => {
    const off = await handleOrgs(new Request("https://atlas.test/api/orgs"), { TENANT: env.TENANT }, { identify: async () => ({ userId: ALICE }) });
    expect(off.status).toBe(503);
    const unbound = await handleOrgs(new Request("https://atlas.test/api/orgs"), { TENANCY_ENABLED: "1" }, { identify: async () => ({ userId: ALICE }) });
    expect(unbound.status).toBe(503);
  });
});
