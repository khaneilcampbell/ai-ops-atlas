// Benjaire private dashboard Worker (ADR-0005).
// Order on every request: authenticate, then route. Static assets are served
// only after the Access JWT checks out (run_worker_first in wrangler.jsonc).
import { parseConfig, tokenFrom, verifyAccessJwt, type Identity, type JwksFetcher } from './access';
import * as db from './db';
import { CATEGORIES, currentMonthNY, isMonth, previousMonth, summarizeMonth, validateExpense } from './finance';
import { apiError, json, readJson, sameOriginJson, withSecurityHeaders } from './http';
import { buildTiles } from './overview';
import { SOURCES, connectionStatus, type ConnectionStatus, type SourceKey } from './sources';

// Access signing keys rotate rarely; cache them per isolate for 10 minutes.
let jwksCache: { url: string; at: number; value: { keys: JsonWebKey[] } } | null = null;
const fetchJwks: JwksFetcher = async (url) => {
  if (jwksCache && jwksCache.url === url && Date.now() - jwksCache.at < 600_000) return jwksCache.value as { keys: [] };
  const res = await fetch(url, { signal: AbortSignal.timeout(5_000) });
  if (!res.ok) throw new Error(`jwks ${res.status}`);
  const value = (await res.json()) as { keys: JsonWebKey[] };
  jwksCache = { url, at: Date.now(), value };
  return value as { keys: [] };
};

async function authenticate(req: Request, env: Env): Promise<Identity | null> {
  // Local development only: `wrangler dev` on localhost with ALLOW_LOCAL_DEV
  // set in .dev.vars (git-ignored). Production hostnames never match.
  const { hostname } = new URL(req.url);
  if (env.ALLOW_LOCAL_DEV === 'true' && (hostname === 'localhost' || hostname === '127.0.0.1') && env.DEV_EMAIL) {
    return { email: env.DEV_EMAIL };
  }
  const result = await verifyAccessJwt(tokenFrom(req), parseConfig(env), fetchJwks);
  if (result.ok) return result.identity;
  console.warn('access denied', result.reason);
  return null;
}

function denied(req: Request): Response {
  if (new URL(req.url).pathname.startsWith('/api/')) return apiError(401, 'Sign in through Cloudflare Access.');
  return withSecurityHeaders(
    new Response(
      '<!doctype html><meta charset="utf-8"><title>Benjaire Ops</title><p>This dashboard is private. Sign in through Cloudflare Access.</p>',
      { status: 401, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } },
    ),
  );
}

async function connections(env: Env): Promise<Map<SourceKey, ConnectionStatus>> {
  const runs = await db.lastRuns(env.DB);
  const vars = env as unknown as Record<string, unknown>;
  return new Map(SOURCES.map((s) => [s.key, connectionStatus(s, vars, runs.get(s.key))]));
}

async function financeSummary(env: Env, month: string) {
  const expenses = await db.listExpenses(env.DB);
  return { expenses, current: summarizeMonth(expenses, month), previous: summarizeMonth(expenses, previousMonth(month)) };
}

async function handleApi(req: Request, env: Env, me: Identity, url: URL): Promise<Response> {
  const path = url.pathname;
  const method = req.method;

  if (method !== 'GET' && !sameOriginJson(req)) return apiError(403, 'Requests must come from the dashboard.');

  if (path === '/api/me' && method === 'GET') return json({ ok: true, email: me.email });

  if (path === '/api/connections' && method === 'GET') {
    return json({ ok: true, connections: [...(await connections(env)).values()] });
  }

  if (path === '/api/overview' && method === 'GET') {
    const month = currentMonthNY();
    const [conns, fin] = await Promise.all([connections(env), financeSummary(env, month)]);
    const tiles = buildTiles(conns, {
      current: fin.current.totals.accrual_cents,
      previous: fin.previous.totals.accrual_cents,
      hasEntries: fin.expenses.length > 0,
    });
    return json({ ok: true, month, tiles });
  }

  if (path === '/api/finance/summary' && method === 'GET') {
    const month = url.searchParams.get('month') ?? currentMonthNY();
    if (!isMonth(month)) return apiError(400, 'Use a month like 2026-10.');
    const fin = await financeSummary(env, month);
    return json({ ok: true, categories: CATEGORIES, current: fin.current, previous: fin.previous, revenue: { state: 'not_connected', source: 'Stripe' } });
  }

  if (path === '/api/expenses' && method === 'GET') return json({ ok: true, expenses: await db.listExpenses(env.DB) });

  if (path === '/api/expenses' && method === 'POST') {
    let body: unknown;
    try {
      body = await readJson(req);
    } catch {
      return apiError(400, 'The request could not be read.');
    }
    const { expense, errors } = validateExpense(body);
    if (!expense) return apiError(422, 'Please fix the highlighted fields.', { fields: errors });
    return json({ ok: true, expense: await db.createExpense(env.DB, me.email, expense) }, 201);
  }

  const match = path.match(/^\/api\/expenses\/([0-9a-f-]{36})$/);
  if (match && (method === 'PUT' || method === 'DELETE')) {
    const before = await db.getExpense(env.DB, match[1]);
    if (!before) return apiError(404, 'That expense no longer exists.');
    if (method === 'DELETE') {
      await db.deleteExpense(env.DB, me.email, before);
      return json({ ok: true });
    }
    let body: unknown;
    try {
      body = await readJson(req);
    } catch {
      return apiError(400, 'The request could not be read.');
    }
    const { expense, errors } = validateExpense(body);
    if (!expense) return apiError(422, 'Please fix the highlighted fields.', { fields: errors });
    return json({ ok: true, expense: await db.updateExpense(env.DB, me.email, before, expense) });
  }

  if (path === '/api/audit' && method === 'GET') {
    const limit = Math.min(Math.max(Number(url.searchParams.get('limit') ?? '50') || 50, 1), 200);
    const before = Number(url.searchParams.get('before') ?? '') || undefined;
    return json({ ok: true, entries: await db.listAudit(env.DB, limit, before) });
  }

  return apiError(404, 'Not found.');
}

export default {
  async fetch(req, env): Promise<Response> {
    const me = await authenticate(req, env);
    if (!me) return denied(req);
    const url = new URL(req.url);
    if (url.pathname.startsWith('/api/')) {
      try {
        return await handleApi(req, env, me, url);
      } catch (err) {
        // Log the message only: never request bodies, tokens or stack traces with data.
        console.error('api error', url.pathname, err instanceof Error ? err.message : 'unknown');
        return apiError(500, 'Something went wrong. Try again in a moment.');
      }
    }
    const asset = await env.ASSETS.fetch(req);
    const cache = url.pathname.startsWith('/assets/') ? 'private, max-age=31536000, immutable' : 'no-store';
    return withSecurityHeaders(asset, { 'Cache-Control': cache });
  },
} satisfies ExportedHandler<Env>;
