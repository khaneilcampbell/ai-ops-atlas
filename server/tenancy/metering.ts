// Usage metering and quotas, per organization.
//
// Usage events are append-only rows with a deduplication key unique per organization, so a retried
// callback or a replayed webhook never counts twice. Each event says whether its quantity was metered
// (reported by the provider or counted by Atlas itself) or estimated; estimated cost is always its
// own resource type and never mixed into metered totals. Nothing here invents a measurement: an
// event exists only when a caller passes a real figure.
//
// Quotas are enforced in the database with one conditional statement each, so concurrent requests
// can't push an organization past a limit. Exceeding a limit refuses the work; it never buys more.

import type { D1 } from "../live";
import { effectiveEntitlement, isQuotaMetric, quotaLevel, QUOTA_METRICS, SOFT_LIMIT_SHARE, type QuotaMetric } from "../../src/tenancy/plans";
import { audit, auditStatement, changes, first, newId, nowIso, type Authorized, type OrgRow } from "./core";
import { settingsOf, type Result } from "./repo";

export const USAGE_TYPES = [
  "workflow_execution",
  "task_execution",
  "model_request",
  "model_input_tokens",
  "model_output_tokens",
  "execution_seconds",
  "integration_call",
  "storage_bytes",
  "estimated_cost_usd_micros",
] as const;
export type UsageType = (typeof USAGE_TYPES)[number];
const isUsageType = (v: unknown): v is UsageType => typeof v === "string" && (USAGE_TYPES as readonly string[]).includes(v);

export interface UsageInput {
  resourceType: UsageType;
  quantity: number;
  unit: string;
  measurement: "metered" | "estimated";
  dedupKey: string;
  providerRef?: string | null;
  correlationId?: string | null;
}

export function usageProblem(e: Partial<UsageInput>): string | null {
  if (!isUsageType(e.resourceType)) return "Unknown usage type.";
  if (typeof e.quantity !== "number" || !Number.isFinite(e.quantity) || e.quantity < 0) return "Quantity must be a number of zero or more.";
  if (typeof e.unit !== "string" || !e.unit || e.unit.length > 20) return "Unit is required.";
  if (e.measurement !== "metered" && e.measurement !== "estimated") return "measurement must be metered or estimated.";
  if (e.resourceType === "estimated_cost_usd_micros" && e.measurement !== "estimated") return "Cost from Atlas is an estimate; mark it estimated.";
  if (typeof e.dedupKey !== "string" || !e.dedupKey || e.dedupKey.length > 200) return "dedupKey is required.";
  return null;
}

/** Appends usage events for one organization. Returns how many were new (duplicates are ignored). */
export async function recordUsage(db: D1, orgId: string, events: UsageInput[], now: number): Promise<number> {
  let added = 0;
  for (const e of events) {
    if (usageProblem(e)) continue;
    const r = await db
      .prepare("INSERT OR IGNORE INTO usage_events (id, org_id, resource_type, quantity, unit, measurement, at, provider_ref, correlation_id, dedup_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(newId("use"), orgId, e.resourceType, e.quantity, e.unit, e.measurement, nowIso(now), e.providerRef ?? null, e.correlationId ?? null, e.dedupKey)
      .run();
    added += changes(r);
  }
  return added;
}

const PERIOD = /^\d{4}-\d{2}$/;

/** Totals for a billing period (calendar month, UTC), split by measurement. */
export async function usageForPeriod(db: D1, a: Authorized, period: string) {
  if (!PERIOD.test(period)) return null;
  const { results } = await db
    .prepare("SELECT resource_type AS resourceType, unit, measurement, SUM(quantity) AS total, COUNT(*) AS events FROM usage_events WHERE org_id = ? AND substr(at, 1, 7) = ? GROUP BY resource_type, unit, measurement ORDER BY resource_type")
    .bind(a.org.id, period)
    .all();
  return { period, rows: results };
}

// ── Quotas ───────────────────────────────────────────────────────────────────

const DAILY = new Set<QuotaMetric>(["daily_tasks", "daily_api_requests"]);
const MONTHLY = new Set<QuotaMetric>(["monthly_model_tokens", "artifact_storage_bytes"]);
export const periodFor = (metric: QuotaMetric, now: number) => (DAILY.has(metric) ? nowIso(now).slice(0, 10) : MONTHLY.has(metric) ? nowIso(now).slice(0, 7) : "all");

export type QuotaAnswer = { ok: true; used: number; limit: number; warning: boolean } | { ok: false; status: 429; message: string; used: number; limit: number };

/** Atomically adds `qty` to a counted quota, or refuses if that would pass the limit. */
export async function consume(db: D1, org: Pick<OrgRow, "id" | "settings">, metric: QuotaMetric, qty: number, now: number, actor = "atlas"): Promise<QuotaAnswer> {
  const limit = effectiveEntitlement(settingsOf(org)).limits[metric];
  const period = periodFor(metric, now);
  const before = (await first<{ used: number }>(db, "SELECT used FROM quota_counters WHERE org_id = ? AND metric = ? AND period = ?", org.id, metric, period))?.used ?? 0;
  const refuse = async () => {
    await audit(db, { orgId: org.id, actor, action: "quota.exceeded", target: metric, outcome: "denied", detail: { limit, used: before, asked: qty } }, now);
    return { ok: false as const, status: 429 as const, message: `This organization has reached its ${metric.replace(/_/g, " ")} limit (${limit}).`, used: before, limit };
  };
  if (qty > limit) return refuse();
  // One statement adds and returns the new total, or returns nothing when it would pass the limit.
  const { results } = await db
    .prepare("INSERT INTO quota_counters (org_id, metric, period, used) VALUES (?, ?, ?, ?) ON CONFLICT (org_id, metric, period) DO UPDATE SET used = used + excluded.used WHERE quota_counters.used + excluded.used <= ? RETURNING used")
    .bind(org.id, metric, period, qty, limit)
    .all<{ used: number }>();
  if (!results.length) return refuse();
  const used = results[0].used;
  const warning = used >= limit * SOFT_LIMIT_SHARE;
  if (warning && used - qty < limit * SOFT_LIMIT_SHARE) await audit(db, { orgId: org.id, actor, action: "quota.warning", target: metric, outcome: "allowed", detail: { limit, used } }, now);
  return { ok: true, used, limit, warning };
}

/** Takes one concurrent-execution slot, atomically. The lease expires after the plan's longest execution time. */
export async function acquireLease(db: D1, org: Pick<OrgRow, "id" | "settings">, dispatchId: string, now: number): Promise<{ ok: true; leaseId: string } | { ok: false; limit: number }> {
  const ent = effectiveEntitlement(settingsOf(org));
  const id = newId("lease");
  const at = nowIso(now);
  const r = await db
    .prepare("INSERT INTO execution_leases (id, org_id, dispatch_id, acquired_at, expires_at) SELECT ?, ?, ?, ?, ? WHERE (SELECT COUNT(*) FROM execution_leases WHERE org_id = ? AND expires_at > ?) < ?")
    .bind(id, org.id, dispatchId, at, nowIso(now + ent.limits.execution_seconds_max * 1000), org.id, at, ent.limits.concurrent_executions)
    .run();
  return changes(r) === 1 ? { ok: true, leaseId: id } : { ok: false, limit: ent.limits.concurrent_executions };
}

export const releaseLease = (db: D1, orgId: string, dispatchId: string) => db.prepare("DELETE FROM execution_leases WHERE org_id = ? AND dispatch_id = ?").bind(orgId, dispatchId).run();

export async function quotaStatus(db: D1, a: Authorized, now: number) {
  const ent = effectiveEntitlement(settingsOf(a.org));
  const out = [];
  for (const metric of QUOTA_METRICS) {
    const limit = ent.limits[metric];
    let used = 0;
    if (metric === "concurrent_executions") used = (await first<{ n: number }>(db, "SELECT COUNT(*) AS n FROM execution_leases WHERE org_id = ? AND expires_at > ?", a.org.id, nowIso(now)))?.n ?? 0;
    else if (metric !== "execution_seconds_max") used = (await first<{ used: number }>(db, "SELECT used FROM quota_counters WHERE org_id = ? AND metric = ? AND period = ?", a.org.id, metric, periodFor(metric, now)))?.used ?? 0;
    out.push({ metric, period: periodFor(metric, now), used, limit, level: metric === "execution_seconds_max" ? "ok" : quotaLevel(used, limit) });
  }
  return { plan: { id: ent.id, label: ent.label, commerciallyAvailable: ent.commerciallyAvailable }, quotas: out };
}

/** Owner-only (quota.override): raise or lower one limit for this organization, or clear the override (null). */
export async function setQuotaOverride(db: D1, a: Authorized, metric: unknown, value: unknown, now: number): Promise<Result<null>> {
  if (!isQuotaMetric(metric)) return { ok: false, status: 400, message: "Unknown quota." };
  if (value !== null && (typeof value !== "number" || !Number.isFinite(value) || value < 0)) return { ok: false, status: 400, message: "Value must be a number of zero or more, or null to clear." };
  const s = settingsOf(a.org);
  const overrides = { ...(s.quotaOverrides ?? {}) };
  if (value === null) delete overrides[metric];
  else overrides[metric] = Math.floor(value as number);
  await db.batch([
    db.prepare("UPDATE organizations SET settings = ?, updated_at = ? WHERE id = ?").bind(JSON.stringify({ ...s, quotaOverrides: overrides }), nowIso(now), a.org.id),
    auditStatement(db, { orgId: a.org.id, actor: a.userId, action: "quota.override", target: metric, outcome: "allowed", detail: { value: value as number | null } }, now),
  ]);
  return { ok: true, value: null };
}
