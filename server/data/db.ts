// The one door to PostgreSQL. The site reaches the database through a Cloudflare Hyperdrive
// binding (ATLAS_DB), which pools connections and keeps the database password out of the code and
// out of the page; ATLAS_DATABASE_URL is the fallback for local runs. Each request runs in one
// transaction with a statement timeout, and the whole request has a hard time limit.

import postgres from "postgres";

/** What the data API needs from a database. Tests pass PGlite; the site passes postgres.js. */
export interface Db {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
  /** Runs fn in one transaction: everything it wrote is kept, or nothing is. */
  tx<T>(fn: (db: Db) => Promise<T>): Promise<T>;
}

export interface DbEnv {
  /** Cloudflare Hyperdrive binding in front of the Atlas database. */
  ATLAS_DB?: { connectionString: string };
  /** Local or emergency fallback: a postgres:// URL. Server-side only; never a VITE_ variable. */
  ATLAS_DATABASE_URL?: string;
}

export const STATEMENT_TIMEOUT_MS = 5_000;
export const REQUEST_TIMEOUT_MS = 8_000;

export function connectionStringOf(env: DbEnv): string | null {
  const s = env.ATLAS_DB?.connectionString ?? env.ATLAS_DATABASE_URL ?? "";
  return /^postgres(ql)?:\/\//.test(s.trim()) ? s.trim() : null;
}

/** Fails with a clear message instead of waiting on a slow or unreachable database. */
export async function withTimeout<T>(work: Promise<T>, ms = REQUEST_TIMEOUT_MS): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const limit = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new DbUnavailable(`The database didn't answer within ${ms / 1000} seconds.`)), ms);
  });
  try {
    return await Promise.race([work, limit]);
  } finally {
    clearTimeout(timer);
  }
}

export class DbUnavailable extends Error {}

type Sql = ReturnType<typeof postgres>;

function wrap(sql: Sql | postgres.TransactionSql): Db {
  return {
    query: async <T,>(text: string, params: unknown[] = []) => (await sql.unsafe(text, params as postgres.ParameterOrJSON<never>[])) as unknown as T[],
    tx: async <T,>(fn: (db: Db) => Promise<T>) => {
      if (!("begin" in sql)) return fn(wrap(sql));
      return (await sql.begin(async (t) => {
        await t.unsafe(`SET LOCAL statement_timeout = ${STATEMENT_TIMEOUT_MS}`);
        return fn(wrap(t));
      })) as T;
    },
  };
}

/**
 * Opens a small client for one request and closes it after. With Hyperdrive the real connections
 * are pooled at the edge, so this is cheap. Type parsing is left to the API (fetch_types off), so
 * no extra round trip is spent on it.
 */
export async function withDb<T>(env: DbEnv, fn: (db: Db) => Promise<T>): Promise<T> {
  const url = connectionStringOf(env);
  if (!url) throw new DbUnavailable("No database is configured.");
  const sql = postgres(url, { max: 2, fetch_types: false, connect_timeout: 5, idle_timeout: 5, prepare: true, onnotice: () => {} });
  try {
    return await withTimeout(fn(wrap(sql)));
  } finally {
    // Don't wait on a clean close: the answer is ready, and the platform ends the socket anyway.
    void sql.end({ timeout: 1 }).catch(() => {});
  }
}
