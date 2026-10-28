// Usage sync for the hosted web build. The Mac app pushes the usage records it logged
// (tokens, requests, estimated cost, model, repository: never a key) to /api/usage/push,
// and the signed-in page reads the latest snapshot from /api/usage.
//
// The push route is exempt from the Access check because the Mac app has no Access session;
// it needs the USAGE_SYNC_TOKEN shared secret instead, which only the Mac's Keychain and the
// Cloudflare secret hold. Reads stay behind Access like every other route.

export interface Kv {
  get(key: string): Promise<string | null>;
  put(key: string, value: string): Promise<void>;
}

export interface UsageEnv {
  /** KV namespace binding that holds the latest snapshot. */
  USAGE?: Kv;
  /** Shared secret the Mac app sends as a Bearer token. */
  USAGE_SYNC_TOKEN?: string;
}

export const PUSH_PATH = "/api/usage/push";
const KEY = "snapshot";
export const MAX_BYTES = 2_000_000;
export const MAX_RECORDS = 5_000;
const noStore = { "cache-control": "no-store" };

const reply = (status: number, body: unknown) => Response.json(body, { status, headers: noStore });

/** Compares two strings without returning early on the first difference. */
export function sameSecret(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

export async function pushUsage(req: Request, env: UsageEnv, now = Date.now()): Promise<Response> {
  if (!env.USAGE || !env.USAGE_SYNC_TOKEN) return reply(503, { message: "Usage sync isn't set up on the site yet (USAGE binding or USAGE_SYNC_TOKEN secret missing)." });
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!token || env.USAGE_SYNC_TOKEN.length < 32 || !sameSecret(token, env.USAGE_SYNC_TOKEN)) return reply(401, { message: "The sync key doesn't match the site's USAGE_SYNC_TOKEN." });

  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > MAX_BYTES) return reply(413, { message: "Snapshot too large." });
  const text = await req.text();
  if (text.length > MAX_BYTES) return reply(413, { message: "Snapshot too large." });

  let body: { records?: unknown; agent?: unknown };
  try {
    body = JSON.parse(text);
  } catch {
    return reply(400, { message: "Body isn't JSON." });
  }
  if (!body || typeof body !== "object" || !Array.isArray(body.records)) return reply(400, { message: 'Expected an object with a "records" array.' });
  if (body.records.length > MAX_RECORDS) return reply(413, { message: `At most ${MAX_RECORDS} records.` });

  // Rows are re-validated by the page when it reads them, the same way an imported file is.
  const pushedAt = new Date(now).toISOString();
  await env.USAGE.put(KEY, JSON.stringify({ pushed_at: pushedAt, records: body.records }));
  return reply(200, { pushed_at: pushedAt, records: body.records.length });
}

export async function readUsage(env: UsageEnv): Promise<Response> {
  if (!env.USAGE) return reply(200, { configured: false, snapshot: null });
  const text = await env.USAGE.get(KEY);
  return new Response(`{"configured":true,"snapshot":${text ?? "null"}}`, { status: 200, headers: { ...noStore, "content-type": "application/json" } });
}
