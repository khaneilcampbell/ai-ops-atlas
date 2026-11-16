// Production health for the site and its integrations: GET /api/health (behind Access) and
// GET /api/hooks/health (the Mac app, with its sync key). Light checks only: one D1 query, GitHub's
// free /rate_limit call, and the n8n summary the site already caches for two minutes. Every check
// says healthy, degraded, unavailable or unknown, and something Atlas can't verify is unknown,
// never healthy. The answer names which credentials are set, never their values.

import type { AccessEnv } from "./access";
import { reply } from "./http";
import { bearerOk, KEEP_MS, type D1, type LiveEnv } from "./live";
import { n8nSnapshot, type N8nEnv } from "./n8n";
import type { CheckCache } from "./properties";
import { bridgeConfigured, type BridgeEnv } from "./n8nBridge";
import { logEvent } from "./log";
import { DAILY_DISPATCH_CAP } from "../src/execution/n8nBridge";
import type { HealthCheck, HealthReport, HealthState, CredentialStatus } from "../src/observability/health";
import { overallState, HEALTH_THRESHOLDS as T } from "../src/observability/health";

export type HealthEnv = AccessEnv &
  LiveEnv &
  N8nEnv &
  BridgeEnv & {
    GITHUB_TOKEN?: string;
    CLOUDFLARE_API_TOKEN?: string;
    N8N_REGISTRY_WEBHOOK_URL?: string;
  };

type Fetcher = typeof fetch;
const set = (v?: string) => !!v && v.trim().length > 0;
const long = (v?: string) => !!v && v.trim().length >= 32;
const ago = (ms: number) => (ms < 3_600_000 ? `${Math.max(1, Math.round(ms / 60_000))} min ago` : ms < 172_800_000 ? `${Math.round(ms / 3_600_000)} h ago` : `${Math.round(ms / 86_400_000)} days ago`);

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([p, new Promise<T>((_, reject) => (timer = setTimeout(() => reject(new Error("timeout")), ms)))]);
  } finally {
    clearTimeout(timer);
  }
}

/** The credentials the site uses, by name, and whether each one is set. Never the value. */
export function credentialStatus(env: HealthEnv): CredentialStatus[] {
  return [
    { id: "access", label: "Cloudflare Access (team domain + audience)", configured: set(env.ACCESS_TEAM_DOMAIN) && set(env.ACCESS_AUD), scope: "Verifies every signed-in request" },
    { id: "allowed-emails", label: "Owner allowlist (ALLOWED_EMAILS)", configured: set(env.ALLOWED_EMAILS), scope: "Second check on top of the Access policy" },
    { id: "sync", label: "Mac app sync key (USAGE_SYNC_TOKEN)", configured: long(env.USAGE_SYNC_TOKEN), scope: "Mac app reads and its few reviewed actions" },
    { id: "agent-feed", label: "Agent feed key (AGENT_FEED_TOKEN)", configured: long(env.AGENT_FEED_TOKEN), scope: "Add-only: outside pipelines report runs" },
    { id: "github-webhook", label: "GitHub App webhook secret", configured: set(env.GITHUB_WEBHOOK_SECRET), scope: "Signs GitHub deliveries" },
    { id: "github-token", label: "GitHub read token (GITHUB_TOKEN)", configured: set(env.GITHUB_TOKEN), scope: "Read-only GitHub proxy and alert counts" },
    { id: "n8n-key", label: "n8n API key (N8N_API_KEY)", configured: set(env.N8N_API_KEY), scope: "Read-only workflow and run list" },
    { id: "n8n-bridge", label: "n8n step runner keys (N8N_BRIDGE_TOKEN + N8N_BRIDGE_CALLBACK_TOKEN)", configured: long(env.N8N_BRIDGE_TOKEN) && long(env.N8N_BRIDGE_CALLBACK_TOKEN), scope: "Six allow-listed steps, 20 a day" },
    { id: "cloudflare", label: "Cloudflare read token (CLOUDFLARE_API_TOKEN)", configured: set(env.CLOUDFLARE_API_TOKEN), scope: "Website analytics, read-only" },
    { id: "alerts", label: "Alert email (RESEND_API_KEY + ALERT_EMAIL_TO)", configured: set(env.RESEND_API_KEY) && set(env.ALERT_EMAIL_TO), scope: "Agent failure and silence emails" },
    { id: "production-keys", label: "Production agent keys (PRODUCTION_AGENT_KEYS)", configured: set(env.PRODUCTION_AGENT_KEYS), scope: "One key per agent, own repository only" },
  ];
}

async function databaseCheck(db: D1 | undefined, now: number): Promise<{ check: HealthCheck; lastGithubAt: number | null; lastProductionAt: number | null; lastAgentRunAt: number | null }> {
  const at = new Date(now).toISOString();
  if (!db) return { check: { id: "database", label: "Live database (D1)", state: "unavailable", critical: true, detail: "The LIVE D1 binding isn't attached to the site.", checkedAt: at }, lastGithubAt: null, lastProductionAt: null, lastAgentRunAt: null };
  const started = Date.now();
  try {
    const q = (sql: string) => withTimeout(db.prepare(sql).all<{ t: string | null }>(), T.databaseTimeoutMs);
    // One round trip per question, each on the `at` index. A missing table means nothing was ever stored.
    const latest = async (where: string) => {
      try {
        return (await q(`SELECT MAX(at) AS t FROM events WHERE ${where}`)).results[0]?.t ?? null;
      } catch (e) {
        if (/no such table/i.test(String(e))) return null;
        throw e;
      }
    };
    await q("SELECT 1 AS t");
    const [gh, prod, run] = await Promise.all([latest("source = 'github'"), latest("kind = 'production'"), latest("kind = 'agent_run'")]);
    const ms = Date.now() - started;
    const slow = ms > T.databaseSlowMs;
    const p = (s: string | null) => (s ? Date.parse(s) : null);
    return {
      check: { id: "database", label: "Live database (D1)", state: slow ? "degraded" : "healthy", critical: true, detail: slow ? `Answered in ${ms} ms (slow; over ${T.databaseSlowMs} ms).` : `Answered in ${ms} ms.`, checkedAt: at },
      lastGithubAt: p(gh),
      lastProductionAt: p(prod),
      lastAgentRunAt: p(run),
    };
  } catch (e) {
    return { check: { id: "database", label: "Live database (D1)", state: "unavailable", critical: true, detail: String(e).includes("timeout") ? `No answer within ${T.databaseTimeoutMs} ms.` : "The query failed.", checkedAt: at }, lastGithubAt: null, lastProductionAt: null, lastAgentRunAt: null };
  }
}

async function githubApiCheck(env: HealthEnv, fetcher: Fetcher, now: number): Promise<HealthCheck> {
  const base = { id: "github-api", label: "GitHub API (site token)", checkedAt: new Date(now).toISOString() };
  const token = env.GITHUB_TOKEN?.trim();
  if (!token) return { ...base, state: "unknown", detail: "No GITHUB_TOKEN on the site; the web page reads GitHub without a token (60 requests an hour)." };
  try {
    // /rate_limit doesn't count against the limit.
    const r = await fetcher("https://api.github.com/rate_limit", { headers: { accept: "application/vnd.github+json", "user-agent": "ai-ops-atlas-web", authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(T.probeTimeoutMs) });
    if (r.status === 401) return { ...base, state: "unavailable", detail: "GitHub refused the site's token (expired or revoked)." };
    if (!r.ok) return { ...base, state: "degraded", detail: `GitHub answered ${r.status}.` };
    const j = (await r.json()) as { resources?: { core?: { limit?: number; remaining?: number } } };
    const core = j.resources?.core;
    if (!core?.limit) return { ...base, state: "unknown", detail: "GitHub answered without a rate limit." };
    const left = (core.remaining ?? 0) / core.limit;
    return left < T.githubRemainingDegraded ? { ...base, state: "degraded", detail: `${core.remaining} of ${core.limit} requests left this hour.` } : { ...base, state: "healthy", detail: `${core.remaining} of ${core.limit} requests left this hour.` };
  } catch {
    return { ...base, state: "unavailable", detail: `GitHub didn't answer within ${T.probeTimeoutMs} ms.` };
  }
}

function webhookCheck(env: HealthEnv, last: number | null, now: number): HealthCheck {
  const base = { id: "github-webhooks", label: "GitHub webhooks", checkedAt: new Date(now).toISOString() };
  if (!set(env.GITHUB_WEBHOOK_SECRET)) return { ...base, state: "unknown", detail: "GITHUB_WEBHOOK_SECRET isn't set, so live GitHub updates are off." };
  if (last === null) return { ...base, state: "unknown", detail: `No deliveries stored in the last ${KEEP_MS / 86_400_000} days; can't tell whether they arrive.` };
  return { ...base, state: "healthy", detail: `Last delivery ${ago(now - last)}.` };
}

async function n8nCheck(env: HealthEnv, cache: CheckCache | null, fetcher: Fetcher, now: number): Promise<{ check: HealthCheck; successRate: number | null; failures24h: number | null; running: number | null }> {
  const base = { id: "n8n", label: "n8n workflows", checkedAt: new Date(now).toISOString() };
  try {
    const snap = await n8nSnapshot(env, cache, fetcher, now);
    if (snap.state !== "ok") return { check: { ...base, state: "unknown", detail: "No n8n API key on the site." }, successRate: null, failures24h: null, running: null };
    const runs = snap.workflows.filter((w) => w.active).flatMap((w) => w.runs);
    const ok = runs.filter((r) => r.status === "success").length;
    const bad = runs.filter((r) => r.status === "error" || r.status === "crashed").length;
    const running = runs.filter((r) => r.status === "running" || r.status === "waiting").length;
    const failures24h = snap.workflows.filter((w) => w.active).reduce((n, w) => n + w.failures24h, 0);
    const successRate = ok + bad ? ok / (ok + bad) : null;
    const state: HealthState = failures24h >= T.n8nFailuresDegraded || (successRate !== null && successRate < T.successRateDegraded) ? "degraded" : "healthy";
    const rate = successRate === null ? "no finished runs in the window" : `${Math.round(successRate * 100)}% of recent runs succeeded`;
    return { check: { ...base, state, detail: `${snap.workflows.filter((w) => w.active).length} published workflows, ${rate}, ${failures24h} failed in 24 h.` }, successRate, failures24h, running };
  } catch (e) {
    return { check: { ...base, state: "unavailable", detail: e instanceof Error && e.name === "TimeoutError" ? "n8n didn't answer in time." : e instanceof Error ? e.message : "n8n couldn't be read." }, successRate: null, failures24h: null, running: null };
  }
}

async function bridgeCheck(env: HealthEnv, now: number): Promise<HealthCheck> {
  const base = { id: "n8n-bridge", label: "n8n step runner (execution adapter)", checkedAt: new Date(now).toISOString() };
  if (!bridgeConfigured(env)) return { ...base, state: "unknown", detail: "Not set up on the site; Atlas can't send steps to n8n." };
  try {
    const since = new Date(now - 86_400_000).toISOString();
    const { results } = await withTimeout(env.LIVE!.prepare("SELECT COUNT(*) AS n, SUM(CASE WHEN state = 'unknown' OR (state = 'sending' AND created_at < ?) THEN 1 ELSE 0 END) AS u FROM n8n_dispatch WHERE created_at >= ?").bind(new Date(now - T.dispatchStuckMs).toISOString(), since).all<{ n: number; u: number | null }>(), T.databaseTimeoutMs);
    const n = results[0]?.n ?? 0;
    const u = results[0]?.u ?? 0;
    if (n >= DAILY_DISPATCH_CAP) return { ...base, state: "degraded", detail: `Daily cap reached (${n} of ${DAILY_DISPATCH_CAP} sends in 24 h); more steps wait until tomorrow.` };
    if (u > 0) return { ...base, state: "degraded", detail: `${u} send${u === 1 ? "" : "s"} in 24 h got no clear answer and need checking in n8n.` };
    return { ...base, state: n ? "healthy" : "unknown", detail: n ? `${n} of ${DAILY_DISPATCH_CAP} sends used in 24 h, all answered.` : "Set up; nothing sent in 24 h, so not yet proven." };
  } catch (e) {
    if (/no such table/i.test(String(e))) return { ...base, state: "unknown", detail: "Set up; nothing has ever been sent." };
    return { ...base, state: "unknown", detail: "Couldn't read the send log." };
  }
}

function productionCheck(env: HealthEnv, last: number | null, now: number): HealthCheck {
  const base = { id: "production-agents", label: "Production agent reporting", checkedAt: new Date(now).toISOString() };
  if (!set(env.PRODUCTION_AGENT_KEYS)) return { ...base, state: "unknown", detail: "No production agents report yet (PRODUCTION_AGENT_KEYS not set)." };
  if (last === null) return { ...base, state: "unknown", detail: "No production report stored in the last 3 days." };
  const age = now - last;
  return age > T.productionStaleMs ? { ...base, state: "degraded", detail: `Last report ${ago(age)}; agents send a heartbeat every 5 min.` } : { ...base, state: "healthy", detail: `Last report ${ago(age)}.` };
}

export async function healthReport(env: HealthEnv, cache: CheckCache | null, fetcher: Fetcher = fetch, now = Date.now()): Promise<HealthReport> {
  const at = new Date(now).toISOString();
  const access: HealthCheck = set(env.ACCESS_TEAM_DOMAIN) && set(env.ACCESS_AUD)
    ? { id: "access", label: "Sign-in (Cloudflare Access)", state: set(env.ALLOWED_EMAILS) ? "healthy" : "degraded", critical: true, detail: set(env.ALLOWED_EMAILS) ? "Every request is verified, and only the allowlisted owner gets in." : "Every request is verified, but only the Access policy limits who gets in (ALLOWED_EMAILS not set).", checkedAt: at }
    : { id: "access", label: "Sign-in (Cloudflare Access)", state: "unavailable", critical: true, detail: "ACCESS_TEAM_DOMAIN or ACCESS_AUD missing; the site refuses every API request.", checkedAt: at };
  const [db, gh, n8n] = await Promise.all([databaseCheck(env.LIVE, now), githubApiCheck(env, fetcher, now), n8nCheck(env, cache, fetcher, now)]);
  const bridge = db.check.state === "unavailable" ? { id: "n8n-bridge", label: "n8n step runner (execution adapter)", state: "unknown" as const, detail: "Unknown while the database is unavailable.", checkedAt: at } : await bridgeCheck(env, now);
  const checks: HealthCheck[] = [access, db.check, gh, webhookCheck(env, db.lastGithubAt, now), n8n.check, bridge, productionCheck(env, db.lastProductionAt, now)];
  return {
    overall: overallState(checks),
    checkedAt: at,
    checks,
    credentials: credentialStatus(env),
    metrics: {
      workflowSuccessRate: n8n.successRate,
      workflowFailures24h: n8n.failures24h,
      runningExecutions: n8n.running,
      lastAgentRunAt: db.lastAgentRunAt ? new Date(db.lastAgentRunAt).toISOString() : null,
    },
  };
}

function logReport(r: HealthReport) {
  const bad = r.checks.filter((c) => c.state === "unavailable" || c.state === "degraded");
  if (bad.length) logEvent({ event: "health.check", service: "health", severity: bad.some((c) => c.state === "unavailable" && c.critical) ? "error" : "warn", detail: bad.map((c) => `${c.id}=${c.state}`).join(", ") });
}

/** GET /api/health, behind Access. */
export async function readHealth(env: HealthEnv, cache: CheckCache | null, fetcher: Fetcher = fetch): Promise<Response> {
  const r = await healthReport(env, cache, fetcher);
  logReport(r);
  return reply(200, r);
}

/** GET /api/hooks/health: the same report for the Mac app, with its sync key. */
export async function readHealthForApp(req: Request, env: HealthEnv, cache: CheckCache | null, fetcher: Fetcher = fetch): Promise<Response> {
  if (!env.USAGE_SYNC_TOKEN) return reply(503, { message: "Website sync isn't set up on the site yet (USAGE_SYNC_TOKEN missing)." });
  if (!bearerOk(req, env.USAGE_SYNC_TOKEN)) return reply(401, { message: "The sync key doesn't match the site's USAGE_SYNC_TOKEN." });
  return readHealth(env, cache, fetcher);
}
